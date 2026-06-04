/**
 * Hermes Media — Dashboard Plugin
 *
 * Browse, preview, upload, and manage files stored in /data/media.
 * Plain IIFE, no build step. Uses window.__HERMES_PLUGIN_SDK__ for React
 * and design-system components.
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;
  const { Button } = SDK.components;
  const { useState, useEffect, useCallback, useRef } = SDK.hooks;

  // -------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------

  const API = "/api/plugins/media";

  /** Extensions that should never be rendered as text preview. */
  var SKIP_TEXT_PREVIEW = {
    pdf: true, doc: true, docx: true, xls: true, xlsx: true,
    zip: true, gz: true, tar: true, rar: true, "7z": true,
    exe: true, dmg: true, so: true, dll: true, bin: true,
    jpg: true, jpeg: true, png: true, gif: true, webp: true,
    svg: true, bmp: true, ico: true, tiff: true, avif: true,
    mp4: true, webm: true, mkv: true, avi: true, mov: true,
    mp3: true, wav: true, ogg: true, flac: true, aac: true,
  };

  // -------------------------------------------------------------------
  // Auth-aware fetch helpers
  // -------------------------------------------------------------------

  function authHeaders(extra) {
    var token = window.__HERMES_SESSION_TOKEN__ || "";
    var hdrs = {};
    hdrs["X-Hermes-Session-Token"] = token;
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        hdrs[keys[i]] = extra[keys[i]];
      }
    }
    return hdrs;
  }

  function fetchBlobUrl(url) {
    return fetch(url, { headers: authHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error("Fetch failed (" + res.status + ")");
        return res.blob();
      })
      .then(function (blob) {
        return URL.createObjectURL(blob);
      });
  }

  function authFetch(url, opts) {
    opts = opts || {};
    var callerHeaders = opts.headers || {};
    opts.headers = authHeaders(callerHeaders);
    return fetch(url, opts);
  }

  // -------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------

  function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    var val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
    return val + " " + units[i];
  }

  function formatTime(ts) {
    if (typeof SDK.utils.timeAgo === "function") {
      return SDK.utils.timeAgo(ts * 1000);
    }
    try {
      return new Date(ts * 1000).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      });
    } catch (e) { return ""; }
  }

  function extLabel(file) {
    if (file.is_image) return { icon: "🖼️", label: "Image", color: "#818cf8" };
    if (file.is_video) return { icon: "🎬", label: "Video", color: "#f472b6" };
    if (file.is_audio) return { icon: "🎵", label: "Audio", color: "#34d399" };
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    var map = {
      pdf: ["📕", "PDF", "#ef4444"],
      doc: ["📝", "DOC", "#60a5fa"], docx: ["📝", "DOC", "#60a5fa"],
      txt: ["📄", "TEXT", "#9ca3af"],
      zip: ["📦", "ZIP", "#fbbf24"], gz: ["📦", "GZIP", "#fbbf24"],
      tar: ["📦", "TAR", "#fbbf24"],
      json: ["{ }", "JSON", "#fbbf24"],
      csv: ["📊", "CSV", "#34d399"],
      md: ["📑", "MD", "#a78bfa"],
      py: ["🐍", "PY", "#60a5fa"],
      js: ["📜", "JS", "#fbbf24"],
      ts: ["📜", "TS", "#3b82f6"],
      html: ["🌐", "HTML", "#f97316"],
      css: ["🎨", "CSS", "#818cf8"],
    };
    var entry = map[ext];
    return entry
      ? { icon: entry[0], label: entry[1], color: entry[2] }
      : { icon: "📄", label: ext.toUpperCase() || "FILE", color: "#9ca3af" };
  }

  function getExt(file) {
    return (file.name.split(".").pop() || "").toLowerCase();
  }

  // -------------------------------------------------------------------
  // Confirm dialog
  // -------------------------------------------------------------------

  function ConfirmDialog(props) {
    return h("div", { className: "hermes-media-confirm-overlay", onClick: props.onCancel },
      h("div", { className: "hermes-media-confirm-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, "Delete file?"),
        h("p", null, "Are you sure you want to delete ",
          h("strong", null, props.filename), "?"),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { className: "cancel", onClick: props.onCancel }, "Cancel"),
          h("button", { className: "confirm", onClick: props.onConfirm }, "Delete"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Rename dialog
  // -------------------------------------------------------------------

  function RenameDialog(props) {
    var _s = useState(props.currentName);
    var newName = _s[0];
    var setNewName = _s[1];
    var _e = useState(null);
    var err = _e[0];
    var setErr = _e[1];
    var _busy = useState(false);
    var busy = _busy[0];
    var setBusy = _busy[1];
    var inputRef = useRef(null);

    // Auto-focus and select the name (without extension) on mount
    useEffect(function () {
      if (inputRef.current) {
        inputRef.current.focus();
        var dot = props.currentName.lastIndexOf(".");
        inputRef.current.setSelectionRange(0, dot > 0 ? dot : props.currentName.length);
      }
    }, []);

    function handleSubmit(e) {
      e.preventDefault();
      var trimmed = newName.trim();
      if (!trimmed || trimmed === props.currentName) {
        props.onClose();
        return;
      }
      setBusy(true);
      setErr(null);
      SDK.fetchJSON(API + "/file/" + encodeURIComponent(props.path), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }).then(function (data) {
        setBusy(false);
        if (data.error) { setErr(data.error); return; }
        props.onRenamed(data.path, data.name);
      }).catch(function (err) {
        setBusy(false);
        setErr(err.message || "Rename failed");
      });
    }

    return h("div", { className: "hermes-media-confirm-overlay", onClick: props.onClose },
      h("div", { className: "hermes-media-confirm-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, "Rename file"),
        h("form", { onSubmit: handleSubmit, style: { margin: "0.75rem 0" } },
          h("input", {
            ref: inputRef,
            type: "text",
            value: newName,
            onChange: function (e) { setNewName(e.target.value); },
            className: "hermes-rename-input",
            disabled: busy,
          }),
          err && h("div", { className: "hermes-rename-error" }, err),
        ),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { type: "button", className: "cancel", onClick: props.onClose,
            disabled: busy }, "Cancel"),
          h("button", { type: "submit", className: "confirm", onClick: handleSubmit,
            disabled: busy, style: { background: "#2563eb", borderColor: "#1d4ed8" } },
            busy ? "Renaming…" : "Rename"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Auth-aware image preview (fetches with token, shows blob URL)
  // -------------------------------------------------------------------

  function FilePreview(props) {
    var file = props.file;
    var onClick = props.onClick;
    var _s = useState(null);
    var blobUrl = _s[0];
    var setBlobUrl = _s[1];
    var urlRef = useRef(null);

    useEffect(function () {
      var fileUrl = API + "/file/" + encodeURIComponent(file.path);
      fetchBlobUrl(fileUrl).then(function (u) {
        urlRef.current = u;
        setBlobUrl(u);
      }).catch(function () { /* silent — show placeholder */ });
      return function () {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
      };
    }, [file.path]);

    if (file.is_image) {
      if (blobUrl) {
        return h("div", { className: "hermes-media-preview clickable", onClick: onClick },
          h("img", { src: blobUrl, alt: file.name, loading: "lazy" }),
        );
      }
      return h("div", { className: "hermes-media-preview" },
        h("div", { className: "hermes-media-preview-icon" },
          h("div", { className: "hermes-media-spinner" }),
          h("span", null, "Loading…"),
        ),
      );
    }

    if (file.is_video) {
      if (blobUrl) {
        return h("div", { className: "hermes-media-preview clickable", onClick: onClick,
          style: { position: "relative" } },
          h("video", { src: blobUrl, preload: "metadata", controls: false },
            h("track", { kind: "captions" }),
          ),
          h("div", { className: "hermes-media-play-overlay" }, "▶"),
        );
      }
      return h("div", { className: "hermes-media-preview" },
        h("div", { className: "hermes-media-preview-icon" },
          h("div", { className: "hermes-media-spinner" }),
          h("span", null, "Loading…"),
        ),
      );
    }

    if (file.is_audio) {
      return h("div", { className: "hermes-media-preview audio-preview", onClick: onClick },
        h("div", { className: "hermes-media-preview-icon" },
          h("span", { style: { fontSize: "2.5rem" } }, "🎵"),
          h("span", null, "Audio"),
        ),
      );
    }

    // Generic file
    var ft = extLabel(file);
    return h("div", { className: "hermes-media-preview clickable", onClick: onClick,
      style: { background: "color-mix(in srgb, " + ft.color + " 8%, var(--color-muted, #111827))" } },
      h("div", { className: "hermes-media-preview-icon" },
        h("span", { style: { fontSize: "2.5rem", color: ft.color } }, ft.icon),
        h("span", { style: { color: ft.color } }, ft.label),
      ),
    );
  }

  // -------------------------------------------------------------------
  // File card
  // -------------------------------------------------------------------

  function FileCard(props) {
    var file = props.file;
    var onDelete = props.onDelete;
    var onPreview = props.onPreview;
    var onRename = props.onRename;
    var _s = useState(false);
    var showConfirm = _s[0];
    var setShowConfirm = _s[1];
    var _r = useState(false);
    var showRename = _r[0];
    var setShowRename = _r[1];
    var ft = extLabel(file);

    function handleDownload(e) {
      e.preventDefault();
      e.stopPropagation();
      var url = API + "/file/" + encodeURIComponent(file.path);
      authFetch(url).then(function (res) {
        return res.blob();
      }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      });
    }

    return h("div", { className: "hermes-media-card" },
      // Floating delete button — top-right corner
      h("button", {
        className: "hermes-media-card-delete",
        onClick: function (e) { e.stopPropagation(); setShowConfirm(true); },
        title: "Delete",
      }, "✕"),
      h(FilePreview, { file: file, onClick: function () { onPreview(file); } }),
      h("div", { className: "hermes-media-info", onClick: function () { onPreview(file); } },
        h("p", { className: "hermes-media-filename", title: file.name }, file.name),
        h("div", { className: "hermes-media-meta" },
          h("span", { style: { color: ft.color } }, ft.icon),
          h("span", null, formatSize(file.size)),
          h("span", null, "·"),
          h("span", null, formatTime(file.mtime)),
        ),
      ),
      h("div", { className: "hermes-media-actions" },
        h("button", { onClick: handleDownload }, "⬇ Download"),
        h("button", { onClick: function (e) {
          e.stopPropagation(); setShowRename(true);
        } }, "✏ Rename"),
      ),
      showConfirm && h(ConfirmDialog, {
        filename: file.name,
        onConfirm: function () { setShowConfirm(false); onDelete(file.path); },
        onCancel: function () { setShowConfirm(false); },
      }),
      showRename && h(RenameDialog, {
        currentName: file.name,
        path: file.path,
        onClose: function () { setShowRename(false); },
        onRenamed: function (newPath, newName) {
          setShowRename(false);
          onRename(file.path, newPath, newName);
        },
      }),
    );
  }

  // -------------------------------------------------------------------
  // Preview modal
  // -------------------------------------------------------------------

  function PreviewModal(props) {
    var file = props.file;
    var onClose = props.onClose;
    var _s1 = useState(null);
    var content = _s1[0];
    var setContent = _s1[1];
    var _s2 = useState(null);
    var blobUrl = _s2[0];
    var setBlobUrl = _s2[1];
    var _s3 = useState(false);
    var loadError = _s3[0];
    var setLoadError = _s3[1];
    var urlRef = useRef(null);

    var ext = getExt(file);
    var isHtml = ext === "html" || ext === "htm";
    var isPdf = ext === "pdf";

    useEffect(function () {
      var fileUrl = API + "/file/" + encodeURIComponent(file.path);
      if (file.is_image || file.is_video || file.is_audio) {
        fetchBlobUrl(fileUrl).then(function (u) {
          urlRef.current = u;
          setBlobUrl(u);
        }).catch(function () {
          setLoadError(true);
        });
      } else if (isPdf) {
        // PDFs: fetch as blob → object URL → embed in iframe
        fetchBlobUrl(fileUrl).then(function (u) {
          urlRef.current = u;
          setBlobUrl(u);
        }).catch(function () {
          setLoadError(true);
        });
      } else if (isHtml) {
        // HTML: fetch as blob → object URL → render in iframe
        fetchBlobUrl(fileUrl).then(function (u) {
          urlRef.current = u;
          setBlobUrl(u);
        }).catch(function () {
          setLoadError(true);
        });
      } else if (!SKIP_TEXT_PREVIEW[ext]) {
        // Text-like files: fetch content via text endpoint
        SDK.fetchJSON(API + "/text/" + encodeURIComponent(file.path))
          .then(function (data) { setContent(data.content); })
          .catch(function () { setContent(null); setLoadError(true); });
      } else {
        // Binary files we can't preview (zip, doc, etc.)
        setLoadError(true);
      }
      return function () {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
      };
    }, [file.path]);

    // ESC to close
    useEffect(function () {
      function onKey(e) { if (e.key === "Escape") onClose(); }
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }, [onClose]);

    var ft = extLabel(file);

    function handleDownload() {
      var url = API + "/file/" + encodeURIComponent(file.path);
      authFetch(url).then(function (res) { return res.blob(); })
        .then(function (blob) {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        });
    }

    function renderContent() {
      // Images
      if (file.is_image && blobUrl) {
        return h("img", { src: blobUrl, alt: file.name, className: "hermes-preview-img" });
      }
      // Videos
      if (file.is_video && blobUrl) {
        return h("video", {
          src: blobUrl, controls: true, autoPlay: true,
          className: "hermes-preview-video",
        }, h("track", { kind: "captions" }));
      }
      // Audio
      if (file.is_audio && blobUrl) {
        return h("div", { className: "hermes-preview-audio-wrap" },
          h("div", { style: { fontSize: "4rem", marginBottom: "1rem" } }, "🎵"),
          h("audio", { src: blobUrl, controls: true, autoPlay: true, style: { width: "100%" } }),
        );
      }
      // PDF — render in iframe
      if (isPdf && blobUrl) {
        return h("iframe", {
          src: blobUrl,
          className: "hermes-preview-iframe",
          title: file.name,
        });
      }
      // HTML — render in iframe (shows actual page, not source).
      // User-uploaded HTML often contains JS that fetches data and
      // populates the page dynamically, so we must allow scripts.
      // allow-same-origin lets blob: resolve relative paths.
      if (isHtml && blobUrl) {
        return h("iframe", {
          src: blobUrl,
          className: "hermes-preview-iframe",
          title: file.name,
          sandbox: "allow-same-origin allow-scripts allow-popups",
        });
      }
      // Text-like files
      if (content !== null) {
        return h("pre", { className: "hermes-preview-text" }, content);
      }
      // Non-previewable binary or error
      if (loadError) {
        return h("div", { className: "hermes-preview-not-previewable" },
          h("div", { style: { fontSize: "3rem", marginBottom: "0.75rem" } }, ft.icon),
          h("p", { style: { fontWeight: 500, fontSize: "1rem", margin: "0 0 0.25rem" } },
            "Preview not available"),
          h("p", { style: { fontSize: "0.85rem", color: "var(--color-muted-foreground, #9ca3af)",
            margin: "0 0 1rem" } },
            ext.toUpperCase() + " files cannot be displayed in the browser."),
          h("button", { className: "hermes-preview-btn", onClick: handleDownload,
            style: { padding: "0.5rem 1.5rem" } }, "⬇ Download to view"),
        );
      }
      // Still loading
      return h("div", { className: "hermes-preview-loading" },
        h("div", { className: "hermes-media-spinner" }),
        h("span", null, "Loading…"),
      );
    }

    return h("div", { className: "hermes-media-preview-overlay", onClick: onClose },
      h("div", { className: "hermes-preview-modal", onClick: function (e) { e.stopPropagation(); } },
        // Header
        h("div", { className: "hermes-preview-header" },
          h("div", { className: "hermes-preview-title" },
            h("span", { style: { color: ft.color, marginRight: "0.5rem" } }, ft.icon),
            h("span", null, file.name),
            h("span", { className: "hermes-media-count",
              style: { marginLeft: "0.5rem" } }, formatSize(file.size)),
          ),
          h("div", { className: "hermes-preview-header-actions" },
            h("button", { className: "hermes-preview-btn", onClick: handleDownload },
              "⬇ Download"),
            h("button", { className: "hermes-preview-close", onClick: onClose }, "✕"),
          ),
        ),
        // Content
        h("div", { className: "hermes-preview-body" }, renderContent()),
        // Footer
        h("div", { className: "hermes-preview-footer" },
          h("span", null, file.mime_type),
          h("span", null, "·"),
          h("span", null, "Modified " + formatTime(file.mtime)),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Upload zone
  // -------------------------------------------------------------------

  function UploadZone(props) {
    var onUploaded = props.onUploaded;
    var _s1 = useState(false);
    var dragging = _s1[0];
    var setDragging = _s1[1];
    var _s2 = useState(false);
    var uploading = _s2[0];
    var setUploading = _s2[1];
    var _s3 = useState(null);
    var error = _s3[0];
    var setError = _s3[1];
    var _s4 = useState(0);
    var uploadProgress = _s4[0];
    var setUploadProgress = _s4[1];
    var _s5 = useState(0);
    var uploadTotal = _s5[0];
    var setUploadTotal = _s5[1];
    var _s6 = useState(null);
    // success: { path, name, size, count } or null
    var success = _s6[0];
    var setSuccess = _s6[1];
    var _s7 = useState(false);
    var copied = _s7[0];
    var setCopied = _s7[1];
    var fileRef = useRef(null);

    function uploadOne(file) {
      var fd = new FormData();
      fd.append("file", file);
      return authFetch(API + "/upload", { method: "POST", body: fd })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          return data;
        });
    }

    function handleFiles(files) {
      if (!files || !files.length) return;
      var arr = [];
      for (var i = 0; i < files.length; i++) arr.push(files[i]);
      setUploading(true);
      setError(null);
      setSuccess(null);
      setCopied(false);
      setUploadProgress(0);
      setUploadTotal(arr.length);

      // Upload sequentially so the server isn't slammed and we can
      // report progress accurately.
      var chain = Promise.resolve();
      var firstError = null;
      var lastResult = null;
      var uploadedCount = 0;
      arr.forEach(function (file, idx) {
        chain = chain.then(function () {
          setUploadProgress(idx + 1);
          return uploadOne(file).then(function (data) {
            lastResult = data;
            uploadedCount++;
          }).catch(function (err) {
            if (!firstError) firstError = file.name + ": " + (err.message || "failed");
          });
        });
      });
      chain.then(function () {
        setUploading(false);
        setUploadProgress(0);
        setUploadTotal(0);
        if (firstError) {
          setError(firstError);
          // If some succeeded too, still show partial success
          if (lastResult && uploadedCount > 0) {
            setSuccess({
              path: lastResult.path,
              name: lastResult.name,
              size: lastResult.size,
              count: uploadedCount,
            });
          }
        } else if (lastResult) {
          setSuccess({
            path: lastResult.path,
            name: lastResult.name,
            size: lastResult.size,
            count: uploadedCount,
          });
        }
        onUploaded();
      });
    }

    function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    }

    function onDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    }

    function onDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
    }

    function copyPath() {
      if (!success || !success.path) return;
      navigator.clipboard.writeText(success.path).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      }).catch(function () {
        // Fallback: select the text
        var el = document.querySelector(".hermes-media-upload-success-path code");
        if (el) {
          var range = document.createRange();
          range.selectNodeContents(el);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }

    var statusText = uploading
      ? (uploadTotal > 1
          ? "Uploading " + uploadProgress + " / " + uploadTotal + "…"
          : "Uploading…")
      : null;

    var successLabel = success && success.count > 1
      ? success.count + " files uploaded"
      : "File saved";

    var hintCommand = success && success.path
      ? "read " + success.path
      : "";

    return h("div", { className: "hermes-media-upload" },
      h("div", {
        className: "hermes-media-dropzone" + (dragging ? " dragging" : ""),
        onDrop: onDrop,
        onDragOver: onDragOver,
        onDragLeave: onDragLeave,
        onClick: function () { if (!uploading && fileRef.current) fileRef.current.click(); },
      },
        h("input", {
          ref: fileRef,
          type: "file",
          multiple: true,
          style: { display: "none" },
          onChange: function () {
            if (fileRef.current && fileRef.current.files.length) {
              handleFiles(fileRef.current.files);
              fileRef.current.value = "";
            }
          },
        }),
        uploading
          ? h("div", { className: "hermes-media-upload-status" },
              h("div", { className: "hermes-media-spinner" }),
              h("span", null, statusText),
            )
          : h("div", { className: "hermes-media-upload-content" },
              h("span", { style: { fontSize: "2rem" } }, "⬆"),
              h("span", null, "Drop files here or click to upload"),
              h("span", { className: "hermes-media-upload-hint" }, "Multiple files supported · Max 50 MB each"),
            ),
      ),
      error && h("div", { className: "hermes-media-upload-error" }, error),
      // Upload success confirmation
      success && !uploading && h("div", { className: "heres-media-upload-success" },
        h("div", { className: "hermes-media-upload-success-label" },
          "✅ ", successLabel,
        ),
        h("div", { className: "hermes-media-upload-success-path" },
          h("code", null, success.path),
        ),
        h("button", {
          className: "hermes-media-copy-btn" + (copied ? " copied" : ""),
          onClick: copyPath,
        }, copied ? "✅ Copied!" : "📋 Copy path to clipboard"),
        h("div", { className: "hermes-media-upload-success-hint" },
          "Paste in chat: ",
          h("code", null, hintCommand),
        ),
        h("button", {
          className: "hermes-media-upload-success-dismiss",
          onClick: function () { setSuccess(null); setCopied(false); },
        }, "dismiss"),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Main component
  // -------------------------------------------------------------------

  function MediaPlugin() {
    var _s1 = useState([]);
    var files = _s1[0];
    var setFiles = _s1[1];
    var _s2 = useState(true);
    var loading = _s2[0];
    var setLoading = _s2[1];
    var _s3 = useState(null);
    var error = _s3[0];
    var setError = _s3[1];
    var _s4 = useState(null);
    var previewFile = _s4[0];
    var setPreviewFile = _s4[1];

    var fetchFiles = useCallback(function () {
      setLoading(true);
      setError(null);
      SDK.fetchJSON(API + "/files")
        .then(function (data) {
          setFiles(data);
          setLoading(false);
        })
        .catch(function (err) {
          setError(err.message || "Failed to load files");
          setLoading(false);
        });
    }, []);

    useEffect(function () {
      fetchFiles();
    }, [fetchFiles]);

    var handleDelete = useCallback(function (path) {
      SDK.fetchJSON(API + "/file/" + encodeURIComponent(path), { method: "DELETE" })
        .then(function () {
          setFiles(function (prev) {
            return prev.filter(function (f) { return f.path !== path; });
          });
        })
        .catch(function (err) {
          alert("Delete failed: " + (err.message || "Unknown error"));
        });
    }, []);

    var handleRename = useCallback(function (oldPath, newPath, newName) {
      setFiles(function (prev) {
        return prev.map(function (f) {
          if (f.path === oldPath) {
            return Object.assign({}, f, { path: newPath, name: newName });
          }
          return f;
        });
      });
    }, []);

    var isEmpty = files.length === 0;

    return h("div", { className: "hermes-media" },
      // Header
      h("div", { className: "hermes-media-header" },
        h("div", { className: "hermes-media-header-left" },
          h("h2", null, "Media Files"),
          !isEmpty && h("span", { className: "hermes-media-count" }, files.length),
        ),
        h(Button, {
          onClick: fetchFiles,
          variant: "outline",
          size: "sm",
        }, "↻ Refresh"),
      ),

      // Upload zone
      h(UploadZone, { onUploaded: fetchFiles }),

      // Error
      error && files.length === 0 && h("div", { className: "hermes-media-error" },
        error,
        h("div", { style: { marginTop: "0.75rem" } },
          h(Button, { onClick: fetchFiles, variant: "outline", size: "sm" }, "Retry"),
        ),
      ),

      // Loading
      loading && files.length === 0 && h("div", { className: "hermes-media-loading" },
        "Loading media files…",
      ),

      // Grid
      !loading && !error && !isEmpty && h("div", { className: "hermes-media-grid" },
        files.map(function (file) {
          return h(FileCard, {
            key: file.path,
            file: file,
            onDelete: handleDelete,
            onPreview: setPreviewFile,
            onRename: handleRename,
          });
        }),
      ),

      // Empty
      !loading && !error && isEmpty && h("div", { className: "hermes-media-empty" },
        h("div", { className: "hermes-media-empty-icon" }, "📁"),
        h("p", { style: { fontWeight: 500, fontSize: "1rem" } }, "No media files yet"),
        h("p", null, "Upload files above or add files to /data/media"),
      ),

      // Preview modal
      previewFile && h(PreviewModal, {
        file: previewFile,
        onClose: function () { setPreviewFile(null); },
      }),
    );
  }

  // -------------------------------------------------------------------
  // Register the plugin component with the host
  // -------------------------------------------------------------------

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("media", MediaPlugin);
  }
})();
