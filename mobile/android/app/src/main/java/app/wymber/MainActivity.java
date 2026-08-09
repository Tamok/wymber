package app.wymber;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiometricVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
