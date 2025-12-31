# Jonathan Castro Personal Website

## 📁 Complete Setup Guide

This guide will walk you through EVERY step needed to get your website live on GitHub Pages with your custom Cloudflare domain (jonathan-castro.com).

---

## 📋 Table of Contents

1. [Files You Need](#files-you-need)
2. [Folder Structure](#folder-structure)
3. [Setting Up Your Local Folder](#setting-up-your-local-folder)
4. [Installing Git](#installing-git)
5. [Creating a GitHub Repository](#creating-a-github-repository)
6. [Uploading Files to GitHub](#uploading-files-to-github)
7. [Enabling GitHub Pages](#enabling-github-pages)
8. [Connecting Cloudflare Domain](#connecting-cloudflare-domain)
9. [Testing Your Website](#testing-your-website)
10. [Future Updates](#future-updates)

---

## 📁 Files You Need

### Website Files (Included)
- `index.html` - Home page with spinning navigation
- `manuscripts.html` - Your 10 books showcase
- `sandbox.html` - Animation demonstrations
- `about.html` - About Me page
- `styles.css` - All the styling for your site

### Media Files (YOU NEED TO PROVIDE)
- `background-home.mp4` - Video background for home page
- `EmbersFalling.mp4` - Video background for other pages
- `KarmakaziLogo-512x512.png` - Your logo (top right corner)
- `KarmakazifaviconICO.ico` - Browser tab icon
- `PicOfJonathanCastro.png` - Your main profile picture
- `PicOfJonathanCastro2.png` - Alternate picture (revealed on hover)

### DNS Configuration File
- `CNAME` - Required for custom domain (we'll create this)

---

## 📂 Folder Structure

Your website folder should look EXACTLY like this:

```
C:\JonathanCastroWebsite\
│
├── index.html                    (Home page)
├── manuscripts.html              (Books page)
├── sandbox.html                  (Animations page)
├── about.html                    (About Me page)
├── styles.css                    (Stylesheet)
├── CNAME                         (Domain configuration)
│
├── background-home.mp4           (Home video - YOU ADD)
├── EmbersFalling.mp4             (Other pages video - YOU ADD)
├── KarmakaziLogo-512x512.png     (Logo - YOU ADD)
├── KarmakazifaviconICO.ico       (Favicon - YOU ADD)
├── PicOfJonathanCastro.png       (Profile pic 1 - YOU ADD)
└── PicOfJonathanCastro2.png      (Profile pic 2 - YOU ADD)
```

---

## 🖥️ Step 1: Setting Up Your Local Folder

### 1.1 Create the Main Folder

1. Open **File Explorer** on your Windows computer
2. Navigate to your **C: drive**
3. Right-click in an empty space
4. Select **New** → **Folder**
5. Name it: `JonathanCastroWebsite`

### 1.2 Add All Files

1. Copy ALL the HTML files (`index.html`, `manuscripts.html`, `sandbox.html`, `about.html`)
2. Copy `styles.css`
3. Copy your media files:
   - `background-home.mp4`
   - `EmbersFalling.mp4`
   - `KarmakaziLogo-512x512.png`
   - `KarmakazifaviconICO.ico`
   - `PicOfJonathanCastro.png`
   - `PicOfJonathanCastro2.png`

### 1.3 Create the CNAME File

This file tells GitHub Pages to use your custom domain.

**IMPORTANT:** The CNAME file has NO file extension!

1. Open **Notepad**
2. Type ONLY this (no extra spaces or lines):
   ```
   jonathan-castro.com
   ```
3. Click **File** → **Save As**
4. Navigate to `C:\JonathanCastroWebsite\`
5. In "File name" field, type: `CNAME` (exactly like this, no .txt)
6. In "Save as type" dropdown, select: **All Files (*.*)**
7. Click **Save**

**To verify:** The file should show as `CNAME` with "File" type, NOT `CNAME.txt`

---

## 🔧 Step 2: Installing Git

Git is the tool that lets you upload files to GitHub from your computer.

### 2.1 Download Git

1. Open your web browser
2. Go to: https://git-scm.com/download/windows
3. The download should start automatically
4. If not, click the download link for your Windows version (usually 64-bit)

### 2.2 Install Git

1. Run the downloaded installer (Git-X.XX.X-64-bit.exe)
2. Click **Next** through the installation screens
3. **IMPORTANT SETTINGS:**
   - Leave "Git Bash Here" checked
   - For the default editor, you can leave "Vim" or select "Notepad" if you prefer
   - Leave all other options as default
4. Click **Install**
5. Click **Finish**

### 2.3 Verify Installation

1. Press **Windows Key + R**
2. Type `cmd` and press Enter
3. In the Command Prompt, type:
   ```
   git --version
   ```
4. You should see something like: `git version 2.XX.X`

---

## 🐙 Step 3: Creating a GitHub Repository

### 3.1 Create a GitHub Account (if you don't have one)

1. Go to: https://github.com
2. Click **Sign up**
3. Follow the prompts to create your account
4. Verify your email address

### 3.2 Create a New Repository

1. Log into GitHub
2. Click the **+** icon in the top right corner
3. Select **New repository**
4. Fill in the details:
   - **Repository name:** `jonathan-castro.github.io`
     - ⚠️ IMPORTANT: Replace `jonathan-castro` with YOUR GitHub username!
     - The format MUST be: `yourusername.github.io`
   - **Description:** "Jonathan Castro Personal Website" (optional)
   - **Public:** Make sure this is selected (required for free GitHub Pages)
   - **DO NOT** check "Add a README file"
   - **DO NOT** add .gitignore
   - **DO NOT** choose a license
5. Click **Create repository**

### 3.3 Copy the Repository URL

After creating, you'll see a page with setup instructions. Look for and copy the HTTPS URL. It looks like:
```
https://github.com/yourusername/yourusername.github.io.git
```

---

## ⬆️ Step 4: Uploading Files to GitHub

### 4.1 Open Git Bash

1. Navigate to `C:\JonathanCastroWebsite\` in File Explorer
2. Right-click in an empty space inside the folder
3. Select **Git Bash Here** (or "Open Git Bash here")

A black terminal window will open.

### 4.2 Configure Git (First Time Only)

In Git Bash, type these commands one at a time, pressing Enter after each:

```bash
git config --global user.name "Your Name"
```

```bash
git config --global user.email "your.email@example.com"
```

Replace with YOUR actual name and email (the email should match your GitHub account).

### 4.3 Initialize and Upload

Type these commands ONE AT A TIME, pressing Enter after each:

**Command 1: Initialize the folder as a Git repository**
```bash
git init
```

**Command 2: Add all files to be tracked**
```bash
git add .
```

**Command 3: Create your first commit**
```bash
git commit -m "Initial website upload"
```

**Command 4: Rename the branch to 'main'**
```bash
git branch -M main
```

**Command 5: Connect to your GitHub repository**
```bash
git remote add origin https://github.com/YOURUSERNAME/YOURUSERNAME.github.io.git
```
⚠️ Replace YOURUSERNAME with your actual GitHub username!

**Command 6: Push (upload) your files**
```bash
git push -u origin main
```

### 4.4 Authentication

- A popup may appear asking you to sign into GitHub
- Sign in with your GitHub credentials
- If using 2FA, you may need to use a Personal Access Token instead of your password

### 4.5 Verify Upload

1. Go to your repository on GitHub
2. Refresh the page
3. You should see all your files listed!

---

## 🌐 Step 5: Enabling GitHub Pages

### 5.1 Access Repository Settings

1. Go to your repository on GitHub
2. Click the **Settings** tab (gear icon)
3. In the left sidebar, click **Pages**

### 5.2 Configure GitHub Pages

1. Under **Source**, select **Deploy from a branch**
2. Under **Branch**, select **main**
3. Leave the folder as **/ (root)**
4. Click **Save**

### 5.3 Wait for Deployment

- GitHub will start building your site
- This usually takes 1-5 minutes
- Refresh the page to see the status
- Once ready, you'll see: "Your site is live at https://yourusername.github.io/"

---

## ☁️ Step 6: Connecting Cloudflare Domain

### 6.1 Log into Cloudflare

1. Go to: https://dash.cloudflare.com
2. Log in to your account
3. Click on your domain: **jonathan-castro.com**

### 6.2 Configure DNS Records

1. Click **DNS** in the left sidebar
2. You need to add/modify these records:

**Record 1: A Record (Root Domain)**
- Type: `A`
- Name: `@`
- IPv4 Address: `185.199.108.153`
- Proxy status: **Proxied** (orange cloud)
- Click **Save**

**Record 2: A Record (Backup 1)**
- Type: `A`
- Name: `@`
- IPv4 Address: `185.199.109.153`
- Proxy status: **Proxied**
- Click **Save**

**Record 3: A Record (Backup 2)**
- Type: `A`
- Name: `@`
- IPv4 Address: `185.199.110.153`
- Proxy status: **Proxied**
- Click **Save**

**Record 4: A Record (Backup 3)**
- Type: `A`
- Name: `@`
- IPv4 Address: `185.199.111.153`
- Proxy status: **Proxied**
- Click **Save**

**Record 5: CNAME Record (www subdomain)**
- Type: `CNAME`
- Name: `www`
- Target: `yourusername.github.io` (your GitHub Pages URL)
- Proxy status: **Proxied**
- Click **Save**

### 6.3 Configure SSL/TLS Settings

1. Click **SSL/TLS** in the left sidebar
2. Under **Overview**, set encryption mode to **Full**
3. Click **Edge Certificates** in the submenu
4. Make sure **Always Use HTTPS** is enabled

### 6.4 Add Custom Domain in GitHub

1. Go back to your GitHub repository
2. Go to **Settings** → **Pages**
3. Under **Custom domain**, enter: `jonathan-castro.com`
4. Click **Save**
5. Check **Enforce HTTPS** (may take a few minutes to become available)

### 6.5 Wait for DNS Propagation

- DNS changes can take anywhere from 5 minutes to 48 hours
- Usually it's about 15-30 minutes
- You can check status at: https://dnschecker.org

---

## ✅ Step 7: Testing Your Website

### Test These URLs:

1. **GitHub Pages URL:** `https://yourusername.github.io`
2. **Custom Domain:** `https://jonathan-castro.com`
3. **WWW Subdomain:** `https://www.jonathan-castro.com`

### Test Each Page:

- Home: `https://jonathan-castro.com/`
- Manuscripts: `https://jonathan-castro.com/manuscripts.html`
- Sandbox: `https://jonathan-castro.com/sandbox.html`
- About: `https://jonathan-castro.com/about.html`

### Things to Check:

- [ ] Videos are playing
- [ ] Logo appears in top right
- [ ] Navigation links work
- [ ] Favicon shows in browser tab
- [ ] Profile picture hover effect works
- [ ] All animations are running
- [ ] Mobile view looks good

---

## 🔄 Step 8: Future Updates

### Making Changes to Your Website

1. Edit the files on your computer in `C:\JonathanCastroWebsite\`
2. Open Git Bash in that folder
3. Run these commands:

```bash
git add .
git commit -m "Description of your changes"
git push
```

### Example Update Commands:

**After editing book blurbs:**
```bash
git add .
git commit -m "Added blurbs for books 1-5"
git push
```

**After adding new animations:**
```bash
git add .
git commit -m "Added particle effect animation to sandbox"
git push
```

---

## 🆘 Troubleshooting

### "Page not found" error
- Make sure your repository name is exactly `yourusername.github.io`
- Check that `index.html` exists in the root folder
- Wait a few minutes for GitHub Pages to deploy

### Videos not playing
- Make sure video files are in the root folder (not in a subfolder)
- Check that filenames match EXACTLY (including capitalization)
- Video files may be too large - consider compressing them

### Custom domain not working
- Double-check DNS records in Cloudflare
- Verify the CNAME file contains your domain with no extra characters
- Wait for DNS propagation (up to 48 hours, usually faster)

### HTTPS not available
- This becomes available after DNS propagation
- Make sure Cloudflare SSL is set to "Full"
- Check "Enforce HTTPS" in GitHub Pages settings

### Git push fails
- Make sure you're logged into GitHub
- Try: `git remote -v` to verify the remote URL is correct
- If using 2FA, create a Personal Access Token

---

## 📞 Quick Reference

| What | Where |
|------|-------|
| Your website files | `C:\JonathanCastroWebsite\` |
| GitHub repository | `github.com/yourusername/yourusername.github.io` |
| GitHub Pages settings | Repository → Settings → Pages |
| Cloudflare DNS | dash.cloudflare.com → Your domain → DNS |
| Your live website | `https://jonathan-castro.com` |

---

## 🎉 You Did It!

Congratulations! Your personal website is now live on the internet with your custom domain. Remember:

- **Edit locally** → **Git push** → **Changes go live automatically**
- GitHub Pages usually updates within 1-2 minutes after a push
- Keep backups of your media files!

Happy coding! 🚀
