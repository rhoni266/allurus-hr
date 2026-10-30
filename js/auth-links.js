// Firebase email links that open allurus.my/auth/action, without the console's "Customize action URL" setting:
// with handleCodeInApp, Firebase's own page only forwards the link (mode and oobCode) to our continue URL instead of
// using it up, so our page checks it and only the person's button press uses it. `next` is where to go afterwards.
window.AllurusAuthLinks = {
  settings(next = '/app') {
    return { url: `${location.origin}/auth/action?next=${encodeURIComponent(next)}`, handleCodeInApp: true };
  },
};
