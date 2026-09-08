// mermaid-init.js - Zero-dependency client-side Mermaid rendering for mdBook
(function () {
    function loadScript(src, callback) {
        let s = document.createElement("script");
        s.src = src;
        s.onload = callback;
        s.onerror = function() {
            if (src !== "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js") {
                loadScript("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js", callback);
            }
        };
        document.head.appendChild(s);
    }

    function renderMermaid() {
        if (typeof mermaid === "undefined") return;
        const html = document.documentElement;
        const isDark = html.classList.contains("navy") || 
                       html.classList.contains("coal") || 
                       html.classList.contains("ayu");

        mermaid.initialize({
            startOnLoad: false,
            theme: isDark ? "dark" : "default"
        });

        const codeBlocks = document.querySelectorAll("pre code.language-mermaid");
        codeBlocks.forEach((codeBlock) => {
            const pre = codeBlock.parentElement;
            const div = document.createElement("div");
            div.className = "mermaid";
            div.textContent = codeBlock.textContent;
            pre.parentElement.replaceChild(div, pre);
        });

        mermaid.run();
    }

    function init() {
        if (typeof mermaid === "undefined") {
            const pathToRoot = window.path_to_root || "";
            loadScript(pathToRoot + "mermaid.min.js", renderMermaid);
        } else {
            renderMermaid();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
