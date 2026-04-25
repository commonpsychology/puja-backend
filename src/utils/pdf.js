// utils/pdf.js
export const proxyPdf = (url) =>
  `/api/proxy/pdf?url=${encodeURIComponent(url)}`