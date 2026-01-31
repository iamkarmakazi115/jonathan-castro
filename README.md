# Jonathan Castro Website

A fully customizable multi-page website built for GitHub Pages with a custom domain.

**Live URL:** https://jonathan-castro.com/

---

## 📁 FOLDER STRUCTURE

```
jonathan-castro-website/
│
├── index.html              ← Root redirect (sends visitors to /home/)
├── navigation.js           ← ⭐ MASTER NAVIGATION FILE (edit this to change all nav)
├── navigation.css          ← Shared navigation styles
├── CNAME                   ← GitHub Pages custom domain file
├── README.md               ← This file
│
├── assets/                 ← ⭐ PUT YOUR MEDIA FILES HERE
│   ├── KarmakaziLogo-512x512.png    ← Your logo
│   ├── KarmakazifaviconICO.ico      ← Your favicon
│   └── EmbersFalling.mp4            ← Home page video
│
├── home/                   ← Home page folder
│   ├── index.html          ← Home page HTML
│   ├── styles.css          ← Home page CSS (only affects this page)
│   └── scripts.js          ← Home page JavaScript
│
├── custom-1/               ← Custom 1 page folder
│   ├── index.html
│   ├── styles.css
│   └── scripts.js
│
├── custom-2/               ← Custom 2 page folder
│   ├── index.html
│   ├── styles.css
│   └── scripts.js
│
... (same structure for custom-3 through custom-9)
```

---

## 🚀 HOW TO UPLOAD TO GITHUB

### Step 1: Prepare Your Assets
Before uploading, make sure you have your media files ready:
- `KarmakaziLogo-512x512.png` (your logo)
- `KarmakazifaviconICO.ico` (your favicon)
- `EmbersFalling.mp4` (home page background video)

### Step 2: Upload Files to GitHub

**Option A: Using GitHub Web Interface (Easiest)**

1. Go to your repository on GitHub
2. Click "Add file" → "Upload files"
3. Upload ALL files and folders from this package
4. **IMPORTANT:** Upload your assets to the `assets/` folder:
   - Navigate to the `assets` folder in your repo
   - Upload `KarmakaziLogo-512x512.png`
   - Upload `KarmakazifaviconICO.ico`
   - Upload `EmbersFalling.mp4`
5. Commit the changes

**Option B: Using Git Command Line**

```bash
# Navigate to your local repository
cd your-repo-folder

# Copy all website files to your repo
# (replace /path/to/downloaded/files with actual path)
cp -r /path/to/downloaded/files/* .

# Add your assets
cp /path/to/KarmakaziLogo-512x512.png ./assets/
cp /path/to/KarmakazifaviconICO.ico ./assets/
cp /path/to/EmbersFalling.mp4 ./assets/

# Stage all files
git add .

# Commit
git commit -m "Initial website upload"

# Push to GitHub
git push origin main
```

### Step 3: Verify GitHub Pages Settings
1. Go to your repository → Settings → Pages
2. Ensure "Source" is set to your main branch
3. Custom domain should already show "jonathan-castro.com"
4. Check "Enforce HTTPS" if available

### Step 4: Wait for Deployment
- GitHub Pages may take 1-10 minutes to deploy
- Visit https://jonathan-castro.com to see your site

---

## ✏️ HOW TO EDIT THE WEBSITE

### Changing Navigation (All Pages)

To add, remove, or rename pages in the navigation menu:

1. Open `navigation.js`
2. Find the `navItems` array (around line 35)
3. Edit as needed:

```javascript
navItems: [
    {
        id: 'home',           // Folder name (don't change unless renaming folder)
        label: 'Home',        // ← CHANGE THIS to change menu text
        href: '/home/'        // URL path (don't change unless renaming folder)
    },
    {
        id: 'custom-1',
        label: 'Custom 1',    // ← Change this to "About" or whatever you want
        href: '/custom-1/'
    },
    // ... more items
]
```

**To add a new page:**
1. Create a new folder (e.g., `new-page/`)
2. Copy files from any existing custom folder
3. Add a new entry to the `navItems` array

**To remove a page:**
1. Delete the entry from `navItems` array
2. Optionally delete the folder

### Changing a Specific Page

Each page has 3 files you can edit independently:

| File | What to Edit |
|------|--------------|
| `index.html` | Page content (text, structure, images) |
| `styles.css` | Page appearance (colors, fonts, layout) |
| `scripts.js` | Page behavior (animations, interactions) |

**Example: Changing Custom 1's colors**

1. Open `custom-1/styles.css`
2. Find the CSS variables at the top:
```css
:root {
    --page-accent: #ff6b35;  ← Change this color
}
```

### Changing the Logo

1. Replace the file in `assets/KarmakaziLogo-512x512.png` with your new logo
2. Keep the same filename, OR
3. Update the path in `navigation.js`:
```javascript
logo: {
    src: '/assets/YourNewLogo.png',  ← Change filename here
    ...
}
```

### Changing the Home Video

1. Replace `assets/EmbersFalling.mp4` with your new video
2. Keep the same filename, OR
3. Update the path in `home/index.html`:
```html
<source src="/assets/YourNewVideo.mp4" type="video/mp4">
```

---

## 🎨 PAGE STYLING GUIDE

### Color Variables (in each page's styles.css)

```css
:root {
    --page-bg: #0a0a0a;           /* Main background color */
    --page-bg-alt: #111122;       /* Alternate section background */
    --page-text: #ffffff;         /* Main text color */
    --page-accent: #ff6b35;       /* Accent/highlight color (orange) */
    --page-secondary: #1a1a2e;    /* Secondary color */
    --page-border: rgba(255, 107, 53, 0.2);  /* Border color */
}
```

### Navigation Colors (in navigation.css)

```css
:root {
    --nav-bg: rgba(10, 10, 10, 0.85);      /* Nav background */
    --nav-text: #ffffff;                    /* Nav link text */
    --nav-text-hover: #ff6b35;              /* Nav link hover color */
    --nav-accent: #ff6b35;                  /* Active link color */
}
```

---

## 📱 RESPONSIVE DESIGN

The website is fully responsive and includes:
- Desktop view (1024px+)
- Tablet view (768px - 1024px)
- Mobile view (< 768px) with hamburger menu

---

## ❓ TROUBLESHOOTING

**Problem: Navigation not showing**
- Make sure `navigation.js` is in the root folder
- Check that each page has `<script src="/navigation.js"></script>` before `</body>`

**Problem: Video not playing**
- Ensure the video file is in `assets/`
- Check the filename matches exactly (case-sensitive)
- Video must be MP4 format

**Problem: Logo not showing**
- Check the file is in `assets/`
- Verify the path in `navigation.js` is correct

**Problem: Changes not appearing**
- GitHub Pages can take 1-10 minutes to update
- Try hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Clear browser cache

**Problem: Custom domain not working**
- Verify CNAME file exists and contains `jonathan-castro.com`
- Check DNS settings with your domain provider
- Wait up to 24 hours for DNS propagation

---

## 📞 SUPPORT

If you need help, you can:
1. Re-open the conversation with Claude and reference this project
2. Ask about specific files or features you want to change

---

*Website created by Claude for Jonathan Castro*
