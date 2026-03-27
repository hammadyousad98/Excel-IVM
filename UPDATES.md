# How to Release a Software Update

This guide explains how to build a new version of the software and publish it so users in other locations can update automatically.

## Prerequisites
- You must have the code pushed to your GitHub repository: `https://github.com/hammadyousad98/Excel-IVM`
- You must have a **Personal Access Token** (classic) from GitHub with `repo` permissions if you want to auto-publish (optional), or you can manually upload files.

## Step-by-Step Update Process

### 1. Update the Version
Open `package.json` and increase the version number.
```json
{
  "name": "inventory-management-system",
  "version": "1.0.1",  <-- Change this (e.g., to 1.0.2)
  ...
}
```
*Note: The system checks this number. If it's not higher than the user's current version, no update will happen.*

### 2. Build the Application
Run the build command in your terminal:
```bash
npm run build:win
```
This will create a `dist` folder containing the installer.

### 3. Create a GitHub Release
1.  Go to your GitHub repository: [https://github.com/hammadyousad98/Excel-IVM](https://github.com/hammadyousad98/Excel-IVM)
2.  Click on **Releases** (usually on the right sidebar).
3.  Click **Draft a new release**.
4.  **Tag version**: Enter the same version number as in package.json (e.g., `v1.0.1`).
5.  **Release title**: Enter a title (e.g., "Version 1.0.1 - New Features").
6.  **Description**: Describe what's new.

### 4. Upload Assets (Critical Step!)
You MUST upload the following files from your `dist` folder to the release:
1.  `Inventory Management System Setup <version>.exe` (The installer)
2.  `latest.yml` (This file tells the app what the latest version is)

*Note: Do not rename these files. Upload them exactly as they are generated.*

### 5. Publish
Click **Publish release**.

## What Happens on the User's Side?
1.  User opens the app.
2.  App checks GitHub Releases in the background.
3.  If a newer version matches `latest.yml`, a notification appears: "New Update Available".
4.  User clicks "Download".
5.  When finished, user clicks "Restart & Install".
6.  App restarts with the new version.

## Troubleshooting
- **"Update Error"**: Check if the repository is Public. If it's Private, you need to configure a `GH_TOKEN` environment variable for the app (or make the repo public).
- **No Notification**: Ensure the `version` in `latest.yml` (on GitHub) is actually higher than the running app's `package.json` version.
