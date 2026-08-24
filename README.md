# Yahtzee PvP 250-Point Star Variant

This standalone build preserves the real-time Yahtzee PvP prototype mechanics and adds one secondary goal: each player earns a star when their total score reaches 250 points. The star is awarded independently of the match result.

The folder is publish-ready as the root of a GitHub Pages prototype repository. Use your own GitHub username in the hostname and keep the variant description in the repository name or cache-busting query:

`https://<your-github-user>.github.io/yahtzee-pvp-prototype/?v=secondarygoal`

To make the URL work:

1. Create or use a GitHub repository under your account, such as `yahtzee-pvp-prototype`.
2. Upload the contents of this folder, with `index.html` at the repository root.
3. In the repository, open **Settings → Pages** and deploy from the `main` branch and `/ (root)` folder.
4. Wait for the Pages deployment to finish, then open the URL above. The `?v=secondarygoal` part only labels the variant and refreshes cached copies; it does not publish the site.

Open `index.html` directly for a local preview, or serve this folder with any static HTTP server for realtime Firebase behavior.
