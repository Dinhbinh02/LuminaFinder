chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CONVERT_TO_PDF') {
    convertToPdf(request.html, request.filename).then(sendResponse);
    return true;
  }
});

async function convertToPdf(html, filename) {
  const cleanHtml = cleanupHtml(html);

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (content) => { document.open(); document.write(content); document.close(); },
    args: [cleanHtml]
  });

  await new Promise(r => setTimeout(r, 1500));

  await chrome.debugger.attach({ tabId: tab.id }, '1.3');

  let pdfData = null;
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      'Page.printToPDF',
      {
        printBackground: true,
        paperWidth: 8.27,
        paperHeight: 11.69,
        marginTop: 0.6,
        marginBottom: 0.6,
        marginLeft: 0.7,
        marginRight: 0.7,
        scale: 0.9
      }
    );
    pdfData = result.data;
  } finally {
    await chrome.debugger.detach({ tabId: tab.id });
    await chrome.tabs.remove(tab.id);
  }

  if (pdfData) {
    const pdfUrl = `data:application/pdf;base64,${pdfData}`;
    const safeName = filename.replace(/\.[^.]+$/, '') + '.pdf';
    chrome.downloads.download({ url: pdfUrl, filename: safeName, saveAs: false });
    return { success: true };
  }

  return { success: false, error: 'No PDF data returned' };
}

function cleanupHtml(html) {
  const prettyCss = `
    <style>
      * { box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.7;
        color: #1a1a1a;
        margin: 0;
        padding: 0;
        background: white;
      }

      ol, ul {
        margin: 0.4em 0 0.4em 0;
        padding-left: 2em;
      }
      ol { list-style-type: decimal; }
      ul { list-style-type: disc; }

      li {
        margin: 0.3em 0;
        padding-left: 0.3em;
        display: list-item !important;
      }

      p, div {
        margin: 0.3em 0;
      }

      h1, h2, h3 {
        margin-top: 0.8em;
        margin-bottom: 0.3em;
        font-weight: bold;
      }
      h1 { font-size: 18pt; }
      h2 { font-size: 15pt; }
      h3 { font-size: 13pt; }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.5em 0;
      }
      td, th {
        border: 1px solid #ccc;
        padding: 6px 10px;
        vertical-align: top;
      }

      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 0.5em auto;
      }

      .doc-content, .kix-page-content-wrapper {
        padding: 0 !important;
        margin: 0 !important;
      }
    </style>
  `;

  if (html.includes('</head>')) {
    html = html.replace('</head>', prettyCss + '</head>');
  } else if (html.includes('<body')) {
    html = html.replace('<body', prettyCss + '<body');
  } else {
    html = prettyCss + html;
  }

  return html;
}
