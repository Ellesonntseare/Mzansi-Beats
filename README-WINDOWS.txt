MZANSI BEATS / FUTURE//BEATS — PHASE 1 DESIGN RELEASE
==================================================
This release redesigns the existing Mzansi Beats website without changing its
public-video server routes, user accounts, purchase APIs or upload storage.

UPDATE AN EXISTING INSTALLATION (IMPORTANT)
1. Stop the existing Node.js server and make a FULL backup of your site folder.
2. Keep your old data folder, including db.json, uploads and community-videos.
3. Keep VIDEO-FOLDER.txt if you previously selected a special Windows directory.
4. Replace the website application files with the new ZIP contents.
5. Run START-WINDOWS.bat, then open http://localhost:3000 and check Videos.
6. Refresh the public website (Ctrl+Shift+R). Your Cloudflare route must still
   target the actual Node.js port (normally localhost:3000).
7. NEVER upload your data directory, videos or server secrets to a public site.

WHAT'S NEW
- Signal Noir futuristic theme, redesigned headers, desktop sidebar and mobile tabs.
- New discovery-first homepage and fresh genre, chart, library and Studio views.
- Cinematic video theater with For You, Featured and Creators feed tabs.
- Public video cards never describe a viewer's PC or display host video counts.
- Video sources preload around the active player; distant players release memory.
- Music art is loaded only when near the viewport to reduce unnecessary downloads.
- Updated PWA cache and app identity; reduced-motion accessibility support.
- Frontend code is now in public/app.js, public/base.css, public/future.css.

KNOWN LIMITATIONS
- Video transcoding/adaptive-bitrate delivery and a CDN are not part of Phase 1.
- Your Windows PC, internet upstream and configured video source must stay online.
- This is a design/frontend release, NOT a production security audit.
- Videos added to the public library must be authorized for public distribution.

DESIGN UPDATE — PUBLIC VIDEO FEED
- Visitors see a TikTok-style Mzansi Beats experience: For You, Featured, Creators.
- There are no public PC-folder labels, machine-origin messages or video counters.
- The video server and storage remain on the configured Windows computer.
- Admins can still use the Windows launchers to check and configure the video directory.

MZANSI BEATS | PUBLIC TIKTOK-STYLE VIDEO FEED
==============================================

WHAT THIS VERSION DOES
- "For You" combines your PC videos, public viewer uploads, and artist videos.
- "Featured" streams all supported videos in C:\Users\elles\Videos and subfolders
  (up to 3 levels deep, max 600 files) with no manual upload.
- "Creators" shows viewer-contributed public videos. Viewers can sign up and
  post videos up to 250 MB (10 per account/day; 5 GB shared server quota).
- New PC files are discovered about every 15 seconds and appear on page refresh.
- Visitor uploads are saved separately in data\community-videos.
- Admins can hide community videos in the Admin section.
- The public feed has vertical swipe/scroll, autoplay, sound, fullscreen, share.

WINDOWS SETUP
1. Install Node.js 18+ from https://nodejs.org/
2. Extract the ZIP on the PC containing your video folder.
3. VERY IMPORTANT: Check C:\Users\elles\Videos first. Move private,
   copyrighted, or sensitive videos out of that folder: every video there
   and in its subfolders can be viewed by EVERY website visitor.
4. Double-click SETUP-OWNER.bat ONCE to create your admin login. Run this
   BEFORE making the website available to anyone else. Existing installations
   with an admin account do not need this step. Password input is visible
   in the command window, so do this in private.
5. If no featured videos appear, double-click
   CHOOSE-VIDEOS-FOLDER.bat, choose C:\Users\elles\Videos (or your actual
   Videos location), and close any existing Mzansi Beats server windows.
   Double-click TEST-VIDEO-FOLDER.bat to verify the path says connected.
6. Double-click START-WINDOWS.bat. Open http://localhost:3000 and click Videos.
7. Leave the Node server window and PC running for videos to remain available.

ALLOWING PEOPLE OUTSIDE YOUR HOME TO WATCH
- localhost:3000 is accessible only on your PC.
- To serve Internet visitors, connect your domain to a securely configured
  HTTPS reverse proxy/tunnel (for example Cloudflare Tunnel), pointing it
  to http://localhost:3000. A public URL is NOT automatically created.
- Do not expose the computer by blindly forwarding its ports on the router.
- Consider extra security and moderation before inviting public uploads.
- Upload limits are provided, but they do not replace malware scanning,
  content moderation, backups, HTTPS, and abuse prevention for public hosting.

IMPORTANT DATA NOTES
- The ZIP intentionally contains no video files and a clean empty database.
- Back up the old 'data' directory (especially db.json and uploads) before
  replacing an existing installation. Preserve it on upgrades.
- Only files from VIDEO_DIR (and its subdirectories) are included in the public
  PC feed, not the rest of your computer. Set VIDEO_DIR in START-WINDOWS.bat
  to change that folder, or use CHOOSE-VIDEOS-FOLDER.bat instead.
- Browsers play H.264/AAC MP4 and WebM most reliably. MOV, MKV, AVI and WMV
  may show in the feed but can require conversion for browser playback.
- Uploaded content is immediately visible to others; moderate as needed.
- Streaming uses your home upload bandwidth. Your PC must stay online.

TROUBLESHOOTING "NO HOST FOLDER FOUND"
- If you see that exact old message, close all previous server windows,
  replace the project with this new version, and run START-WINDOWS.bat.
- Run CHOOSE-VIDEOS-FOLDER.bat on the PC that has the files, and then
  TEST-VIDEO-FOLDER.bat. The folder chooser saves VIDEO-FOLDER.txt.
- If your browser is pointed at a remotely hosted backend, it cannot read
  C: on your home computer. Point your domain/tunnel to the Windows server.
- If the folder is connected but zero videos appear, check formats and
  subfolders (only the top folder plus 3 levels are searched).
- Do not share the configured folder until you have checked every file
  for privacy and rights to publish it.
