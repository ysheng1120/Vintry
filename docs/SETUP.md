# Setting up Vintry

Vintry runs on a Windows or Mac computer. You need no account and no server. Your cellar is stored in your browser on your own computer.

There are two ways to start Vintry. Choose one:

- **Double-click launcher (recommended).** Vintry runs on your own computer. Setup takes about 5 minutes.
- **Your own web address (optional).** A free hosting service puts Vintry online at your own private address, and it updates itself. Setup takes about 10 minutes.

The two ways keep separate data. To move your cellar from one to the other, use **More → Backup & restore** (see "Move your cellar to another computer or browser" below).

---

## 1. Start Vintry with the launcher

### What you need

- **Node.js**, a free program that Vintry uses to run. Get the **LTS** version from [nodejs.org/en/download](https://nodejs.org/en/download) and install it with the normal installer. You do this only once.
- **The Vintry folder.** On the GitHub page for your Vintry repository, click the green **Code** button, then **Download ZIP**. Unzip it to a folder you can find again, for example `Documents/Vintry`.

### On a Mac

1. Open the Vintry folder and double-click **Start Vintry.command**.
2. **The first time only**, macOS may show "Start Vintry.command could not be verified" (the file is not signed by Apple). Click **Done**. Then open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to "Start Vintry.command". Confirm with your password. After this, a double-click works.
3. A Terminal window opens. The first start takes a minute or two while Vintry gets ready. Then your browser opens Vintry at `http://localhost:47821`.
4. **Keep the Terminal window open** while you use Vintry. Close it to stop Vintry.

### On Windows

1. Open the Vintry folder and double-click **Start Vintry.bat**.
2. **The first time only**, Windows may show "Windows protected your PC" (the file is not signed). Click **More info**, then **Run anyway**.
3. A black command window opens. The first start takes a minute or two. Then your browser opens Vintry at `http://localhost:47821`.
4. **Keep the command window open** while you use Vintry. Close it to stop Vintry.

### Tips

- If you double-click the launcher while Vintry is already running, it only opens the browser.
- If you see "another program is using port 47821", close that program (or restart the computer) and try again. Vintry always uses this address, because your browser keeps your cellar under it.

---

## 2. Install Vintry as an app (optional, recommended)

Installing gives Vintry its own icon and window, and it helps the browser keep your data.

- **Chrome or Edge (Windows or Mac):** with Vintry open, click the install icon at the right end of the address bar (a small screen with an arrow), or open the browser menu and choose **Install Vintry** (Edge: **Apps → Install this site as an app**).
- **Safari on Mac:** with Vintry open, choose **File → Add to Dock**. This matters in Safari: Safari can remove data of websites you have not visited for 7 days, but it keeps the data of apps in your Dock.

---

## 3. Add an AI key (optional)

Vintry works without AI. With an AI key, you can also scan labels, add wine by typing one sentence, get drinking-window estimates, tidy tasting notes, map unusual CSV files, and ask the sommelier about your cellar.

Vintry uses Anthropic's Claude. You pay Anthropic directly for what you use. There is no subscription. The cost depends on the model you choose and how much you use it; Settings shows the price of one label scan with each model, and your running total.

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account.
2. Open **Billing** and add a small amount of credit (for example $5). Set a monthly spend limit under **Limits** if you want a hard cap.
3. Open **API Keys**, click **Create Key**, name it "Vintry", and copy the key (it starts with `sk-ant-`).
4. In Vintry, open **More → Settings**, paste the key, and click **Test key**.

In Settings you can also choose the AI model. Each option shows what one label scan costs with it. Settings shows your AI usage and its estimated cost.

---

## 4. Your own web address (optional)

Use this if you want Vintry to update itself when the code changes, or to open it without the launcher. Both services below are free for personal use and work with a private GitHub repository. GitHub Pages is not used, because it needs a paid GitHub plan for private repositories.

### Cloudflare Pages

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, and allow access to your Vintry repository.
3. Select the repository. Set **Framework preset** to **Vite** (build command `npm run build`, output folder `dist`). Under **Environment variables**, add `NODE_VERSION` = `22`.
4. Click **Save and Deploy**. After a few minutes you get an address like `https://vintry-abc.pages.dev`.

### Netlify

1. Create a free account at [app.netlify.com](https://app.netlify.com).
2. Click **Add new site → Import an existing project → GitHub**, and select your Vintry repository.
3. Netlify reads the settings from `netlify.toml`. Click **Deploy**.
4. You get an address like `https://vintry-abc.netlify.app`.

Keep the address private if you like; there is nothing to log in to, because your data is only in your browser. Open the address, then install it as an app (step 2).

---

## Updating Vintry

- **Your own web address:** it updates by itself when the repository changes. Vintry shows "A new version is available" with a **Reload** button.
- **Launcher:** download the latest ZIP (step 1), and unzip it over your existing Vintry folder (or into the same place). Double-click the launcher again. Your data stays, because the address `http://localhost:47821` does not change.

See **More → What's new** for the list of changes.

---

## Back up your cellar

Your cellar lives in your browser. Back it up now and then:

- Open **More → Backup & restore** and click **Export backup**. Save the file somewhere safe, for example a cloud-synced folder.
- In Chrome and Edge you can choose a backup folder once. After that, **Back up now** saves a dated file there in one click and keeps the newest 10.
- Vintry reminds you to back up after 20 changes or 14 days.

### Move your cellar to another computer or browser

1. On the old one: **More → Backup & restore → Export backup**.
2. On the new one: start Vintry and, on the first screen, choose **Restore from a Vintry backup** (or later: **More → Backup & restore → Restore from backup**).

---

## Privacy

- Your cellar and your AI key stay in your browser on your computer. Vintry has no server and no account.
- When you use an AI feature, only what that feature needs goes to Anthropic under your own key: the label photo you scan, the sentence you type, the tasting note you ask it to tidy, the wine details it uses to estimate drinking windows, the wine's name and origin for About this wine, the CSV headers and sample rows you ask it to map, or the cellar details the sommelier looks up.
- The microphone button uses your browser's own speech service (in Chrome, that sends your voice to Google).
- Anyone who can use your computer's browser can open Vintry. Remove your key in **Settings** if you share the computer.

---

## For developers

```bash
npm install
npm run dev        # development server
npm run check      # typecheck, lint, unit tests
npm run test:e2e   # Playwright browser tests
npm run build      # production build in dist/
npm start          # the same as the double-click launcher
```

**Live AI check.** The regular test suite never calls the real Claude API. To sanity-check the
AI features against the live model (costs a few cents), run:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval:ai
```

This uses the default model unless you set `VINTRY_EVAL_MODEL` to a different model id. Without
`ANTHROPIC_API_KEY` set, the suite reports itself as skipped and exits 0.
