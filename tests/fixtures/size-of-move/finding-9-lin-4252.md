## This step

A tidy, done first as its own task: one fake DOM, in a shared test-helper home, used by the two suites above, with the second fake deleted in the same change. It models what a repaint needs: node identity, `replaceWith` and `innerHTML`, an input's value, focus and `document.activeElement`. No production code changes.
