/**
 * First-run tutorial: a short, skippable walkthrough of the map.
 *
 * Trauma-informed onboarding (gradual, brief, validating, skippable, a soft exit, agency): a few
 * calm steps you can leave at any moment and reopen anytime from "How it works". Offered once on
 * first run, never nags. Steps are data-driven, so keeping it current is editing TUTORIAL_STEPS,
 * nothing else. Grounded in the onboarding research linked from /sources.
 */

const SVG = (inner) => `<svg viewBox="0 0 140 96" width="140" height="96" role="img">${inner}</svg>`;
const NODE = (x, y, fill) => `<rect x="${x}" y="${y}" width="34" height="22" rx="7" fill="${fill}"/>`;
const LINE = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#cfc7ba" stroke-width="2.5" stroke-linecap="round"/>`;

// Soft pastels echoing the node palette; calm, not clinical.
const ART = {
    map: SVG(`${LINE(38, 30, 82, 22)}${LINE(50, 46, 86, 60)}${LINE(88, 30, 86, 58)}${NODE(20, 20, '#EDDCB8')}${NODE(78, 12, '#B7D5F0')}${NODE(72, 50, '#D8ECB4')}${NODE(34, 40, '#C9C3EE')}`),
    add: SVG(`${NODE(36, 38, '#B7D5F0')}<circle cx="92" cy="35" r="13" fill="#D8ECB4"/><path d="M92 29v12M86 35h12" stroke="#3b6b57" stroke-width="2.5" stroke-linecap="round"/>`),
    link: SVG(`${LINE(46, 48, 94, 48)}${NODE(20, 37, '#EDDCB8')}${NODE(86, 37, '#C9C3EE')}`),
    unlink: SVG(`${LINE(46, 48, 63, 48)}${LINE(77, 48, 94, 48)}<g stroke="#c98a8a" stroke-width="2.2" stroke-linecap="round"><line x1="66" y1="44" x2="74" y2="52"/><line x1="74" y1="44" x2="66" y2="52"/></g>${NODE(20, 37, '#EDDCB8')}${NODE(86, 37, '#C9C3EE')}`),
    gentle: SVG(`<circle cx="70" cy="48" r="26" fill="none" stroke="#D8ECB4" stroke-width="3"/><circle cx="70" cy="48" r="16" fill="none" stroke="#C9C3EE" stroke-width="3"/><circle cx="70" cy="48" r="7" fill="#EDDCB8"/>`),
};

export const TUTORIAL_STEPS = [
    {
        art: ART.map,
        title: 'Welcome to your map',
        body: `A private space to lay out what you've been through, at your own pace. Everything stays on this device, encrypted. There's no right way to do this.`,
    },
    {
        art: ART.add,
        title: 'Add what matters',
        body: `Use "+ Add Node" to place an experience, a feeling, a person, a place. Add as few or as many as feel right.`,
    },
    {
        art: ART.link,
        title: 'Connect what relates',
        body: `Choose "Link Nodes", then pick two that belong together to draw a line between them. Nothing has to connect to anything.`,
    },
    {
        art: ART.unlink,
        title: 'Change your mind anytime',
        body: `Open a node to see its Connections and unlink, or tap the line between two. You can edit or remove anything. Nothing here is permanent.`,
    },
    {
        art: ART.gentle,
        title: 'At your own pace',
        body: `There's no rush, and nothing here is required. Grounding and crisis support stay one tap away in the bar above, whenever you need them.`,
    },
];

const SEEN_KEY = 'wymber.tutorialSeen';

export class Tutorial {
    constructor() {
        this.modal = document.getElementById('tutorial-modal');
        this.stepEl = document.getElementById('tutorial-step');
        this.dotsEl = document.getElementById('tutorial-dots');
        this.backBtn = document.getElementById('tutorial-back');
        this.nextBtn = document.getElementById('tutorial-next');
        this.skipBtn = document.getElementById('tutorial-skip');
        this.closeBtn = document.getElementById('close-tutorial');
        this.i = 0;
        this._wired = false;
    }

    _wire() {
        if (this._wired || !this.modal) return;
        this._wired = true;
        this.backBtn?.addEventListener('click', () => this.go(this.i - 1));
        this.nextBtn?.addEventListener('click', () => {
            if (this.i >= TUTORIAL_STEPS.length - 1) this.close();
            else this.go(this.i + 1);
        });
        this.skipBtn?.addEventListener('click', () => this.close());
        this.closeBtn?.addEventListener('click', () => this.close());
    }

    /** Open at the first step. Marks "seen" so the first-run auto-offer never repeats. */
    open() {
        if (!this.modal) return;
        this._wire();
        this.i = 0;
        this.modal.style.display = 'flex';
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) { /* private mode: just don't persist */ }
        this.render();
        setTimeout(() => this.nextBtn?.focus(), 60);
    }

    close() {
        if (this.modal) this.modal.style.display = 'none';
    }

    go(i) {
        if (i < 0 || i >= TUTORIAL_STEPS.length) return;
        this.i = i;
        this.render();
    }

    render() {
        const step = TUTORIAL_STEPS[this.i];
        const last = this.i === TUTORIAL_STEPS.length - 1;

        this.stepEl.classList.remove('is-shown');
        this.stepEl.innerHTML =
            `<div class="tutorial-art" aria-hidden="true">${step.art}</div>` +
            `<h2 class="tutorial-title">${step.title}</h2>` +
            `<p class="tutorial-body">${step.body}</p>`;

        this.dotsEl.innerHTML = TUTORIAL_STEPS
            .map((_, n) => `<span class="tutorial-dot${n === this.i ? ' active' : ''}"></span>`)
            .join('');

        this.backBtn.style.visibility = this.i === 0 ? 'hidden' : 'visible';
        this.nextBtn.textContent = last ? 'Got it' : 'Next';
        this.modal.setAttribute('aria-label', `How Wymber works, step ${this.i + 1} of ${TUTORIAL_STEPS.length}`);

        requestAnimationFrame(() => this.stepEl.classList.add('is-shown'));
    }

    /** Has the first-run walkthrough already been offered on this device? */
    static seen() {
        try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { return false; }
    }
}
