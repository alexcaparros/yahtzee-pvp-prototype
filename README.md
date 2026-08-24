# Yahtzee PvP 250-Point Star Variant

This standalone build preserves the real-time Yahtzee PvP prototype mechanics and adds one secondary goal: each player earns a star when their total score reaches 250 points. The star is awarded independently of the match result.

The lobby variant replaces the dice-token meta with a configurable daily goal. Players progress the daily goal through random-matchmaking wins and by reaching the 250-point secondary goal. Completing the daily goal awards BRs.

The lobby also adds simple tiered matchmaking:

- Tier 1: win meta +2, 250 meta +1, win reward +3 BRs, entry cost 2 BRs.
- Tier 2: win meta +5, 250 meta +2, win reward +8 BRs, entry cost 5 BRs.
- Tier 3: win meta +12, 250 meta +4, win reward +18 BRs, entry cost 10 BRs.

Manual create, join, and public-game tools remain available behind the user icon in the lobby.

This variant is based on the published prototype at:

`https://saraamaral-commits.github.io/yahtzee-pvp-prototype/?v=df3843e`

The published variant URL is:

`https://alexcaparros.github.io/yahtzee-pvp-prototype/?v=df3843e-250-star-daily-matchmaking`

Open `index.html` directly for a local preview, or serve this folder with any static HTTP server for realtime Firebase behavior.
