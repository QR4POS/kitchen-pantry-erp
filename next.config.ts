import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit loads its font metrics (.afm) files from disk relative to its own
  // package directory. Bundling breaks those __dirname-relative reads
  // (ENOENT .../pdfkit/js/data/Helvetica.afm), so keep it external.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
