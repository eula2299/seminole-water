window.WaterHelpDocuments = (() => {
  "use strict";
  let pdf, ocr, downloadUrl;
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  async function library() {
    if (!pdf) {
      pdf = await import("/help/vendor/pdf.mjs");
      pdf.GlobalWorkerOptions.workerSrc = "/help/vendor/pdf.worker.mjs";
    }
    return pdf;
  }
  async function recognize(input, language, progress) {
    if (!window.Tesseract) await loadScript("/help/vendor/tesseract.min.js");
    const languages = {
      en: "eng",
      es: "spa",
      fr: "fra",
      pt: "por",
      ht: "hat",
      ar: "ara",
    };
    if (ocr) await ocr.terminate();
    ocr = await Tesseract.createWorker(languages[language] || "eng", 1, {
      workerPath: "/help/vendor/worker.min.js",
      corePath: "/help/vendor",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (m) => {
        if (m.progress) progress(Math.round(m.progress * 100));
      },
    });
    try {
      return (await ocr.recognize(input)).data.text;
    } finally {
      await ocr.terminate();
      ocr = null;
    }
  }
  async function read(file, language = "en", progress = () => {}) {
    if (!file || file.size > 10 * 1024 * 1024) throw Error("FILE_TOO_LARGE");
    if (/\.(txt|csv)$/i.test(file.name) || /^text\//.test(file.type))
      return (await file.text()).slice(0, 50000);
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const lib = await library(),
        doc = await lib.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise;
      let text = "";
      try {
        if (doc.numPages > 12) throw Error("TOO_MANY_PAGES");
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          let line = "",
            lastY = null,
            part = "";
          for (const item of content.items) {
            if (typeof item.str !== "string") continue;
            const y = Math.round(item.transform[5]);
            if (lastY !== null && Math.abs(y - lastY) > 3) {
              part += line + "\n";
              line = "";
            }
            line += item.str + " ";
            lastY = y;
            if (item.hasEOL) {
              part += line + "\n";
              line = "";
              lastY = null;
            }
          }
          part += line;
          if (part.trim().length < 30) {
            const view = page.getViewport({ scale: 1.5 });
            if (view.width * view.height > 12000000)
              throw Error("IMAGE_TOO_LARGE");
            const canvas = document.createElement("canvas");
            canvas.width = view.width;
            canvas.height = view.height;
            await page.render({
              canvasContext: canvas.getContext("2d"),
              viewport: view,
            }).promise;
            part = await recognize(canvas, language, progress);
            canvas.width = 0;
            canvas.height = 0;
          }
          text += part + "\n\n";
          progress(Math.round((i / doc.numPages) * 100));
          page.cleanup();
          if (text.length > 50000) throw Error("DOCUMENT_TOO_LONG");
        }
        return text;
      } finally {
        await doc.destroy();
      }
    }
    if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
      const bitmap = await createImageBitmap(file);
      const area = bitmap.width * bitmap.height;
      bitmap.close();
      if (area > 20000000) throw Error("IMAGE_TOO_LARGE");
      return (await recognize(file, language, progress)).slice(0, 50000);
    }
    throw Error("FILE_TYPE");
  }
  async function fillForm(fields, map) {
    if (!window.PDFLib) await loadScript("/help/vendor/pdf-lib.min.js");
    const response = await fetch("/help/forms/rd3550-35.pdf");
    if (!response.ok) throw Error("FORM_UNAVAILABLE");
    const doc = await PDFLib.PDFDocument.load(await response.arrayBuffer());
    if (!window.fontkit) await loadScript("/help/vendor/fontkit.umd.min.js");
    doc.registerFontkit(window.fontkit);
    const fontResponse = await fetch("/help/fonts/DejaVuSans.ttf");
    if (!fontResponse.ok) throw Error("FONT_UNAVAILABLE");
    const font = await doc.embedFont(await fontResponse.arrayBuffer(), {
      subset: true,
    });
    const form = doc.getForm();
    const values = { ...fields };
    let repairLines = [];
    if (values.repairs_line_1) {
      let line = "";
      for (const character of Array.from(values.repairs_line_1)) {
        if (
          character === "\n" ||
          font.widthOfTextAtSize(line + character, 10) > 480
        ) {
          repairLines.push(line);
          line = character === "\n" ? "" : character;
        } else line += character;
      }
      if (line) repairLines.push(line);
      for (let i = 0; i < 5; i++)
        values["repairs_line_" + (i + 1)] = repairLines[i] || "";
    }
    for (const [key, value] of Object.entries(values)) {
      if (map[key] && typeof value === "string" && value.trim()) {
        const field = form.getTextField(map[key]);
        field.setText(value);
      }
    } // Signatures and unprovided facts stay blank. Keep original form editable.
    form.updateFieldAppearances(font);
    // Do not silently cut off a resident's explanation when the original form is short.
    for (let offset = 5; offset < repairLines.length; offset += 45) {
      const page = doc.addPage([612, 792]);
      page.drawText("RD 3550-35 - Additional repair details", {
        x: 48,
        y: 744,
        size: 14,
        font,
      });
      repairLines
        .slice(offset, offset + 45)
        .forEach((line, i) =>
          page.drawText(line, { x: 48, y: 710 - i * 14, size: 10, font }),
        );
    }
    return new Blob([await doc.save()], { type: "application/pdf" });
  }
  function download(data, name, type = "text/plain;charset=utf-8") {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    document.getElementById("water-help-download-ready")?.remove();
    const blob = data instanceof Blob ? data : new Blob([data], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    downloadUrl = url;
    a.href = url;
    a.download = name;
    a.textContent = (window.WaterHelpI18n?.t("download") || "Download") + " · " + name;
    a.className = "button quiet";
    const ready = document.createElement("section");
    ready.id = "water-help-download-ready";
    ready.className = "card soft";
    const message = document.createElement("p");
    message.textContent = window.WaterHelpI18n?.t("downloadReady") ||
      "Your file is ready. Use this link if the download did not start.";
    ready.append(message, a);
    (document.getElementById("main") || document.body).append(ready);
    a.click();
  }
  async function copy(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.className = "offscreen";
    document.body.append(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    if (!done) throw Error("COPY_UNAVAILABLE");
  }
  async function inspectForm(file) {
    if (!file || file.size > 10 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) throw Error('FILE_TYPE');
    if (!window.PDFLib) await loadScript('/help/vendor/pdf-lib.min.js');
    const bytes = await file.arrayBuffer();
    const doc = await PDFLib.PDFDocument.load(bytes);
    if (doc.getPageCount() > 40) throw Error('TOO_MANY_PAGES');
    const fields = doc.getForm().getFields().map((f, i) => {
      const kind = ['PDFTextField','PDFCheckBox','PDFDropdown','PDFRadioGroup','PDFOptionList'].find(name=>f instanceof PDFLib[name]) || 'unsupported';
      const rawName=f.getName();
      const usefulName=!/^(?:text|field|fill|check.?box|radio|undefined|untitled)[_ .-]*\d*$/i.test(rawName) && /[a-zA-Z]{3}/.test(rawName);
      const label = f.acroField.getAlternateName?.() || (usefulName ? rawName.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_]+/g,' ').replace(/Row\s*\d+$/i,'').replace(/^\d+\s*/, '').trim() : '');
      const sensitive = /social.?security\s*(?:number|no|#)|\bssn\b|signature|sign.here|certif|attest|penalty|routing|bank.account/i.test(f.getName()+' '+label);
      const selection=f.getSelected?.();
      return { id: f.getName(), label: label || '', number: i+1,
        type: kind === 'PDFTextField' ? 'text' : kind === 'PDFCheckBox' ? 'checkbox' : ['PDFDropdown','PDFRadioGroup','PDFOptionList'].includes(kind) ? 'choice' : 'unsupported',
        options: f.getOptions?.() || [], sensitive, value: f.getText?.() ?? (Array.isArray(selection)?selection[0]:selection) ?? f.isChecked?.() ?? '',
        maxLength: f.getMaxLength?.() || 2000, readOnly: f.isReadOnly?.() || false };
    }).filter(f => f.type !== 'unsupported' && !f.readOnly);
    if (fields.length > 200) throw Error('TOO_MANY_FIELDS');
    return { bytes, fields, name: file.name };
  }
  async function fillUploadedForm(spec, values) {
    const doc = await PDFLib.PDFDocument.load(spec.bytes);
    if (!window.fontkit) await loadScript('/help/vendor/fontkit.umd.min.js');
    doc.registerFontkit(window.fontkit);
    const r = await fetch('/help/fonts/DejaVuSans.ttf');
    if (!r.ok) throw Error('FONT_UNAVAILABLE');
    const font = await doc.embedFont(await r.arrayBuffer(), {subset:true});
    const form = doc.getForm();
    for (const info of spec.fields) {
      if (info.sensitive || !(info.id in values)) continue;
      const f = form.getField(info.id), value = values[info.id];
      if (info.type === 'text') {
        if (String(value).length > info.maxLength) throw Error('ANSWER_TOO_LONG');
        f.setText(String(value));
      } else if (info.type === 'checkbox') value ? f.check() : f.uncheck();
      else if (info.type === 'choice' && info.options.includes(value)) f.select(value);
    }
    form.updateFieldAppearances(font);
    return new Blob([await doc.save()], {type:'application/pdf'});
  }
  return { read, fillForm, inspectForm, fillUploadedForm, download, copy };
})();
