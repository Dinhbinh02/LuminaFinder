# 📂 LuminaFinder

![LuminaFinder Hero](hero.png)

**LuminaFinder** is a lightweight, high-performance Chrome Extension designed to streamline your Google Drive and Google Docs experience. It provides a minimalist, unified interface for scanning folders and downloading files with advanced features like parallel processing and export format selection.

---

## ✨ Features

- **🚀 Parallel Scanning:** High-speed recursive folder scanning using optimized parallel requests.
- **📄 Document Export:** One-click export for Google Docs, Sheets, and Slides into multiple formats (PDF, DOCX, XLSX, etc.).
- **🎬 Video Discovery:** Automatically identifies video streams and direct download links for Google Drive assets.
- **🎨 Minimalist UI:** A sleek, glassmorphism-inspired design with dynamic state animations.
- **🔒 Privacy First:** Local metadata extraction—your cookies and data never leave your browser.
- **🔄 Intelligent Refresh:** Auto-updates expired download links and tokens on-the-fly.

---

## 🛠️ Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/[YOUR_USERNAME]/lumina-finder.git
    ```
2.  **Open Chrome Extensions:**
    Navigate to `chrome://extensions/` in your browser.
3.  **Enable Developer Mode:**
    Toggle the switch in the top right corner.
4.  **Load Unpacked:**
    Click **"Load unpacked"** and select the `lumina-finder` directory.

---

## 📖 Usage

1.  Open any Google Drive folder or document.
2.  Click the **Lumina Finder** icon in your toolbar.
3.  Choose your desired files or export formats.
4.  Hit **Download** and let Lumina do the rest.

---

## 🏗️ Technical Architecture

- **Core:** Manifest V3, JavaScript (ES6+).
- **Styling:** Custom CSS with variable-based design system.
- **Networking:** Asynchronous Proxy Fetching via Background Service Workers to bypass CORS limitations.
- **State Management:** Chrome Local Storage for persistent session restoration.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---


