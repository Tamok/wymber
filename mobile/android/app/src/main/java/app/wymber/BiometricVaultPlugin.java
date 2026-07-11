package app.wymber;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.content.SharedPreferences;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * BiometricVault: biometric unlock for the Wymber vault (issue #146, ADR-0005).
 *
 * Model: the vault's random Data Encryption Key (DEK, 32 bytes) is wrapped by an AES-256-GCM
 * key that lives in the Android Keystore (hardware-backed where available) and can only be
 * used after a BIOMETRIC_STRONG authentication (auth-per-use via CryptoObject). This is a
 * key-release design, not an "is the user authenticated" boolean: without the biometric,
 * the wrapped DEK blob is just ciphertext. The password and recovery code remain the
 * portable unlock roots (ADR-0001); this is device-local convenience, like the planned
 * passkeys. New biometric enrollments permanently invalidate the key (the wrap dies, the
 * vault is untouched; the user falls back to their password).
 *
 * Only the wrapped DEK (iv + ciphertext) is persisted, in app-private SharedPreferences.
 * The raw DEK crosses the Capacitor bridge on enroll/unlock only, which is the same trust
 * domain as the WebView that holds the DEK in memory for the whole session anyway.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {

    private static final String KEY_ALIAS = "wymber-biometric-dek";
    private static final String PREFS = "wymber.biometric";
    private static final String PREF_IV = "iv";
    private static final String PREF_CT = "ct";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int result = BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject ret = new JSObject();
        ret.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("code", result);
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnrolled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enrolled", prefs().contains(PREF_CT) && keystoreHasKey());
        call.resolve(ret);
    }

    /** Wrap the DEK under a new biometric-gated Keystore key. Expects { dek: base64 }. */
    @PluginMethod
    public void enroll(PluginCall call) {
        String dekB64 = call.getString("dek");
        if (dekB64 == null) {
            call.reject("Missing dek");
            return;
        }
        final byte[] dek;
        try {
            dek = Base64.decode(dekB64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid dek encoding");
            return;
        }
        try {
            deleteEnrollment(); // replace any previous enrollment atomically
            SecretKey key = generateKeystoreKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            prompt(call, cipher, "Turn on biometric unlock", (authedCipher) -> {
                byte[] ct = authedCipher.doFinal(dek);
                byte[] iv = authedCipher.getIV();
                java.util.Arrays.fill(dek, (byte) 0);
                prefs().edit()
                        .putString(PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                        .putString(PREF_CT, Base64.encodeToString(ct, Base64.NO_WRAP))
                        .apply();
                JSObject ret = new JSObject();
                ret.put("enrolled", true);
                return ret;
            });
        } catch (Exception e) {
            call.reject("Could not set up biometric unlock: " + e.getMessage());
        }
    }

    /** Release the DEK after a biometric authentication. Returns { dek: base64 }. */
    @PluginMethod
    public void unlock(PluginCall call) {
        String ivB64 = prefs().getString(PREF_IV, null);
        String ctB64 = prefs().getString(PREF_CT, null);
        if (ivB64 == null || ctB64 == null || !keystoreHasKey()) {
            call.reject("Not enrolled", "NOT_ENROLLED");
            return;
        }
        try {
            SecretKey key = loadKeystoreKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivB64, Base64.NO_WRAP)));
            final byte[] ct = Base64.decode(ctB64, Base64.NO_WRAP);
            prompt(call, cipher, "Unlock Wymber", (authedCipher) -> {
                byte[] dek = authedCipher.doFinal(ct);
                JSObject ret = new JSObject();
                ret.put("dek", Base64.encodeToString(dek, Base64.NO_WRAP));
                java.util.Arrays.fill(dek, (byte) 0);
                return ret;
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            // Biometric enrollment changed on the device: the wrap is dead by design.
            deleteEnrollment();
            call.reject("Biometric unlock was reset because the device's biometrics changed.",
                    "INVALIDATED");
        } catch (Exception e) {
            call.reject("Biometric unlock failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        deleteEnrollment();
        JSObject ret = new JSObject();
        ret.put("enrolled", false);
        call.resolve(ret);
    }

    // ----- internals -----

    private interface OnAuthed {
        JSObject run(Cipher cipher) throws Exception;
    }

    /** Show the biometric prompt bound to `cipher`; resolve/reject `call` from the result. */
    private void prompt(PluginCall call, Cipher cipher, String title, OnAuthed onAuthed) {
        FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle("Your map stays on this device.")
                    .setNegativeButtonText("Use password")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build();
            BiometricPrompt bp = new BiometricPrompt(activity,
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            try {
                                call.resolve(onAuthed.run(result.getCryptoObject().getCipher()));
                            } catch (Exception e) {
                                call.reject("Crypto failure after authentication: " + e.getMessage());
                            }
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence message) {
                            boolean cancelled = code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || code == BiometricPrompt.ERROR_USER_CANCELED
                                    || code == BiometricPrompt.ERROR_CANCELED;
                            call.reject(String.valueOf(message), cancelled ? "CANCELLED" : "ERROR");
                        }
                    });
            bp.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey generateKeystoreKey() throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        kg.init(b.build());
        return kg.generateKey();
    }

    private SecretKey loadKeystoreKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        return (SecretKey) ks.getKey(KEY_ALIAS, null);
    }

    private boolean keystoreHasKey() {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            return ks.containsAlias(KEY_ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    private void deleteEnrollment() {
        prefs().edit().remove(PREF_IV).remove(PREF_CT).apply();
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            /* already gone */
        }
    }
}
