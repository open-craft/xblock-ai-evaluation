// we load Marked in a Iframe to avoid RequireJS conflicts with the Xblock runtime
function loadMarkedInIframe() {
  if (!window.marked && !document.getElementById("marked-iframe")) {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("id", "marked-iframe");
    document.head.append(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const script = iframeDoc.createElement("script");
    script.type = "text/javascript";
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js";
    iframeDoc.head.appendChild(script);
  }
}
function MarkdownToHTML(text) {
  window.marked =
    window.marked ??
    document.getElementById("marked-iframe").contentWindow.marked;
  if (typeof marked !== "undefined") text = marked.parse(text);
  return text;
}

function MarkedIsLoaded() {
  return document.getElementById("marked-iframe").contentWindow.marked;
}

function showElemIfText(elem, text) {
  if (text?.length) {
    const html = MarkdownToHTML(text);
    elem.html(html);
    elem.show();
  }
}
function runFuncAfterLoading(func) {
  const markedIframe = document.getElementById("marked-iframe");
  // loading is finished when Marked is available
  if (markedIframe.contentWindow.marked) {
    func();
  } else {
    markedIframe.addEventListener("load", (event) => {
      func();
    });
  }
}
