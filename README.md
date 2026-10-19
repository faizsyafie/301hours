# 301hours

A study tracker and dashboard for CFA candidates. Log at least 300 hours, maybe even 301.

Styled as a trading terminal. Your study hours trade as `$CFA1`, `$CFA2` or `$CFA3`.

- **Dashboard** (home page): hours banked against your target, the hours per day you need before exam day, a grid of 301 squares (one per hour) with milestones, a 30-day price chart (cumulative hours) with daily volume, a time & sales tape of recent sessions, and a watchlist of topics with week-on-week change.
- **Levels**: switch between CFA Level I, II and III in the header. Each level has its own topics, hours and grid. For Level III, pick your pathway (Portfolio Management, Private Wealth or Private Markets) in Topics or Setup.
- **Study**: a Pomodoro timer with a desk cam. The market is open while you're in frame. Walk away and trading halts until you're back. Breaks don't need the camera. Keys: `Space` open/halt, `S` skip, `R` reset.
- **Topics**: the curriculum for each level as a checklist. Rename, re-ticker, add or delist anything to match your curriculum year. The Level II and III module lists follow the recent curriculum structure; check them against yours.
- **Milestones**: crossing 10, 25, 50, 100, 150, 200, 250, 300 and 301 hours triggers a breaking-news banner.
- **Sync**: data is saved in the browser and synced to a small database on Vercel, so it's the same on every device. Protected by a passcode.
- **Navigation**: keys `1`–`4` switch between Dashboard, Study, Topics and Setup.

## How the presence check works

The Study page runs Google's MediaPipe person detector (EfficientDet-Lite0) on your webcam twice a second, entirely in your browser. No video is uploaded or stored. If no person is seen for longer than the grace period (6 seconds by default, adjustable in Settings), the study clock pauses. It resumes as soon as you're back in frame.

Tips:
- Keep the tab visible. Browsers slow down background tabs, which delays detection. Putting the tracker in its own small window works well.
- Turn on **Hide video** if you don't want to see yourself. Detection keeps running.
- Studying away from the camera? Switch the presence check off (those sessions show as "no camera") or use **Log time manually**.

## Deploying to Vercel

1. **Import the repo.** In Vercel, choose *Add New → Project*, import `301hours`, and deploy with the default settings. There is no build step.
2. **Add a database.** In the project, open *Storage → Create Database* (or *Marketplace*), choose **Upstash Redis** (free plan), and connect it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables automatically. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work.
3. **Set a passcode.** In *Settings → Environment Variables*, add `APP_PASSCODE` with a passcode of your choice.
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the new variables are picked up.
5. Open the site and enter your passcode once on each device.

Without steps 2–3 the site still works, but data stays in that one browser. The header shows "This device only".

## Running locally

It's plain HTML/CSS/JS with no dependencies, so any static server works:

```sh
python3 -m http.server 8000
```

The camera needs `http://localhost` or `https://`. To run the sync API locally as well, use `npx vercel dev` with the environment variables above.

## Project layout

```
index.html        app shell
css/styles.css    styles (light and dark)
js/app.js         routing, header, passcode prompt
js/dashboard.js   dashboard page
js/study.js       study page (timer + camera UI)
js/timer.js       Pomodoro state machine
js/presence.js    webcam + person detection
js/topics.js      curriculum checklist
js/settings.js    settings, sync, backup
js/store.js       local storage + sync with /api/data
js/curriculum.js  default CFA Level I-III topics, milestones and settings
js/model.js       per-level stats (hours, streaks, tickers)
js/sounds.js      synthesized bell, register and news-flash sounds
lib/merge.js      merges two copies of the data (shared by browser and API)
api/data.js       Vercel function: GET/PUT the data in Upstash Redis
```
