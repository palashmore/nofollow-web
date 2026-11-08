# NoFollow Web — Complete Beginner Zero-to-Hero Guide
## How to Use https://nofollow-web.vercel.app from Scratch

Welcome to **NoFollow Web**. This guide explains everything from step zero: what the system is, why it works the way it does, how to set it up on any Windows machine, how to connect your Instagram account safely, upload your export files, and run automations.

---

## 1. Understanding the Architecture (Why a Local Agent is Needed)

Unlike simple web apps, **NoFollow Web automates Instagram actions directly** (unfollowing accounts and cancelling pending requests).

### The Security & Privacy Rule:
- **Cloud servers (AWS/Vercel/Render) are banned by Instagram**: If a cloud server tries to log into Instagram on your behalf, Instagram immediately flags the IP as a suspicious data-center bot, triggering account locks, SMS challenges, or bans.
- **Your credentials stay on your computer**: NoFollow Web NEVER sends your Instagram username, password, session cookies, or follower lists to any cloud database. Everything is kept 100% locally on your machine.
- **Vercel** hosts only the **visual frontend UI** (`https://nofollow-web.vercel.app`).
- **Your Windows computer** runs the **Local Agent (`unfollow.mjs`)**, which uses Playwright on your actual home internet connection to perform actions safely with human-like delays.

---

## 2. Step Zero: What You Need

1. A computer running **Windows 10 or 11**.
2. **Google Chrome** (or Microsoft Edge) installed.
3. **Node.js** (v20 or higher) installed on Windows (from [nodejs.org](https://nodejs.org/)).
4. Your official **Instagram Data Export** (JSON or HTML format).

---

## 3. Step-by-Step Walkthrough

```
[Step 1] Download Portable Agent
        │
        ▼
[Step 2] Start Local Agent (run.bat)
        │
        ▼
[Step 3] Open Dashboard (Vercel or Local)
        │
        ▼
[Step 4] Log in to Instagram (Once)
        │
        ▼
[Step 5] Import Instagram Data Export
        │
        ▼
[Step 6] Manage Non-Followers & Cancel Pending Requests
```

---

### Step 1: Download the NoFollow Web Agent

1. Visit the GitHub repository:
   👉 **[https://github.com/palashmore/nofollow-web](https://github.com/palashmore/nofollow-web)**
2. Click the green **`<> Code`** button and select **`Download ZIP`** (or run `git clone https://github.com/palashmore/nofollow-web.git`).
3. Extract the folder to your computer (e.g. `C:\Users\YourName\Downloads\NoFollowWeb-portable`).

---

### Step 2: Start the Local Agent

1. Inside the extracted folder, double-click **`run.bat`** (or open a terminal and run `node unfollow.mjs`).
2. A black terminal window will appear showing:
   ```text
   ==============================================================
   NoFollow Web Local Agent: http://127.0.0.1:4173
   Pairing PIN for Vercel Dashboard: NF-XXXX
   Press Ctrl+C to stop cleanly.
   ==============================================================
   ```
3. Keep this window running in the background while using the app.

> **Optional (Auto-start on Windows boot):**  
> Right-click PowerShell and run:  
> `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`  
> This registers a Windows Task that starts the agent silently every time you turn on your laptop!

---

### Step 3: Connect to the Dashboard

You have two equally great ways to open the dashboard:

#### Method A: Open Directly on Loopback (Recommended for Beginners)
Open your browser and visit:
👉 **`http://127.0.0.1:4173`**
- Instant connection.
- Zero pairing PIN required.
- Zero browser security warnings.

#### Method B: Use the Hosted Vercel URL
Open your browser and visit:
👉 **`https://nofollow-web.vercel.app`**
1. You will see the **Connect Windows Local Agent** screen.
2. Enter the 6-character PIN shown in your terminal (e.g. `NF-9866`).
3. Click **Connect Local Agent**.
4. The dashboard connects to your local machine via secure token.

---

### Step 4: Verify Your Instagram Login

1. Look at the top bar in your dashboard:
   - If the green pill says `Instagram verified (@your_username)`, you are already logged in!
2. If it says `Browser closed` or `Login required`:
   - Click the **"Open Instagram"** (or **"Show Instagram"**) button on the top right.
   - A dedicated Chrome browser window will open to `instagram.com`.
   - Log in to your Instagram account normally.
   - Once logged in, click **"Verify Login"** in the Browser Health card.
   - Your session is now saved in your private local `profile/` folder on your laptop. You will not have to enter your password again.

---

### Step 5: Import Your Instagram Data Export

To see who doesn't follow you back and all pending outgoing follow requests:

1. Request your data export from Instagram:
   - Instagram Settings > Accounts Center > Your Information and Permissions > Download Your Information.
   - Select **Followers and following**.
   - Format: **HTML** or **JSON** (both are fully supported).
2. Once downloaded and extracted, open your NoFollow Web dashboard and click **"Import Data"** in the left sidebar (`#/import-data`).
3. Drag and drop the following files into the import area:
   - `followers_1.html` (or `followers_1.json`)
   - `following.html` (or `following.json`)
   - `pending_follow_requests.html` (or `pending_follow_requests.json`)
4. Click **"Import Selected Files"**.
5. Within 2 seconds, your entire relationship database is computed!

---

### Step 6: Managing Non-Followers (Who Doesn't Follow Back)

1. Click **"Non-Followers"** in the left sidebar (`#/non-followers`).
2. You will see all accounts that you follow who do not follow you back.
3. Choose your automation speed:
   - **Safe Profile (Default & Recommended)**: ~30 seconds wait between actions. Lowest risk of Instagram action blocks.
   - **Balanced Profile**: ~15 seconds wait between actions.
4. Select accounts:
   - Tick individual checkboxes, or click **"Select page"**, or click **"Select all filtered"**.
5. Click **"Start Selected"**.
6. A safety confirmation modal will show the estimated duration and rate limit info.
7. Click **"Start Unfollowing"**.
8. Watch the real-time progress bar. You can click **Pause** or **Stop** at any time.

---

### Step 7: Cancelling Pending Follow Requests (Oldest-First)

If you have sent thousands of follow requests to private accounts over the years, Instagram limits how many requests you can have pending.

1. Click **"Pending Requests"** in the left sidebar (`#/pending-requests`).
2. Notice the two tabs:
   - **Sent (outgoing)**: Requests YOU sent to private accounts. (Only these can be cancelled).
   - **Received (incoming)**: Requests other people sent to you (Informational only, never touched).
3. The list is automatically sorted **Oldest First** (e.g. requests from 2017, 2018, 2019 first).
4. Cancellation Options:
   - **Single account**: Click the **Cancel request** button on any row.
   - **Batch cancel**: Select accounts and click **"Cancel Selected"**.
   - **Cancel All**: Click **"Cancel All Pending"**.
5. Review the confirmation breakdown (Total eligible, already done, accepted).
6. Click **"Confirm Cancellation"**.
7. The worker visits each profile, verifies it still says `Requested`, clicks cancel, and logs the result.

---

## 4. Frequently Asked Questions (FAQ)

### Q: Can another user use `https://nofollow-web.vercel.app` on their own laptop?
**Yes!** Any user who opens `https://nofollow-web.vercel.app` simply downloads the free portable agent from GitHub, runs `run.bat` on their Windows PC, enters their pairing PIN, and uses the exact same interface with their own private Instagram account.

### Q: Does the app keep running if I close the browser tab?
The automation engine runs inside Node.js on your laptop. If you close your browser tab, the worker keeps running until the batch completes or until you stop it. You can reopen the tab anytime to view progress.

### Q: What happens if Instagram shows a security check or CAPTCHA?
The safety monitor detects any challenge or block immediately, halts automation instantly (`SAFETY_PAUSED`), and alerts you with a notification. It will NEVER blindly retry against an action block. You can resolve the challenge in the browser window and press **Resume**.

### Q: Are my files or passwords stored on Vercel?
**Never.** Vercel acts purely as a static CDN for HTML/CSS/JS. All data, tokens, profile cookies, and export files reside exclusively on your local disk in `data/` and `profile/`.
