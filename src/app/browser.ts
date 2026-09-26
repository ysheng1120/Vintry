/** Browser actions behind one object so tests can replace them (jsdom cannot reload). */
export const browser = {
  reload(): void {
    window.location.reload();
  },
};
