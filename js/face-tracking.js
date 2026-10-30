// Face-only crop: body and hand models always keep the full camera frame.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function faceCrop(poseResult, width, height) {
  const points = (poseResult?.landmarks?.[0] ?? []).slice(0, 11)
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) &&
      (p.visibility ?? 0) >= 0.6 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  if (points.length < 5 || width <= 0 || height <= 0) return null;
  const xs = points.map(p => p.x * width), ys = points.map(p => p.y * height);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // Include forehead/chin and room for head movement, without stretching pixels.
  const side = Math.max(96, (maxX - minX) * 2, (maxY - minY) * 3);
  if (side > Math.min(width, height) * 0.8 || maxX - minX < 12) return null;
  return {
    x: clamp((minX + maxX - side) / 2, 0, width - side),
    y: clamp((minY + maxY - side) / 2, 0, height - side),
    size: side,
  };
}

export function restoreFaceCoordinates(result, crop, width, height) {
  if (!crop) return result;
  return {
    ...result,
    faceLandmarks: (result?.faceLandmarks ?? []).map(face => face.map(p => ({
      ...p,
      x: (crop.x + p.x * crop.size) / width,
      y: (crop.y + p.y * crop.size) / height,
      z: (p.z ?? 0) * crop.size / width,
    }))),
    // Crop intrinsics differ from the full-frame camera. Use restored landmark
    // geometry for head orientation, rather than treating a crop matrix as global.
    facialTransformationMatrixes: [],
  };
}
