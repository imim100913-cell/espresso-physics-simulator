/* Contact frames shared by the photo layers, tools and liquid animation. */
(function (scope) {
  "use strict";
  function pose(x, y, scale = 1, anchorX = 320, anchorY = 178) {
    return {
      transform: `translate(${x} ${y}) scale(${scale}) translate(${-anchorX} ${-anchorY})`,
      point(px, py) {
        return { x: x + (px - anchorX) * scale, y: y + (py - anchorY) * scale };
      },
      inverse(px, py) {
        return { x: anchorX + (px - x) / scale, y: anchorY + (py - y) / scale };
      },
      scale,
    };
  }
  function scene(photo, phase) {
    const preparing = phase === "distribute" || phase === "tamp";
    const basket = preparing
      ? pose(320, 230)
      : phase === "grind"
        ? photo
          ? pose(320, 265.6, 0.72)
          : pose(320, 198)
        : photo
          ? pose(320, 185, 0.58)
          : pose(320, 168);
    const plate = photo ? 281 : 342;
    const cup = pose(320, plate, photo ? 0.55 : 0.8, 320, photo ? 377.5 : 377);
    return {
      basket,
      cup,
      scale: pose(320, plate, 1, 320, 281),
      grinder: photo ? "translate(0 0)" : "translate(0 22)",
      chute: photo ? { x: 316.5, y: 237.25 } : { x: 320, y: 170 },
      outlet: basket.point(320, photo ? 248 : 245),
      cupRim: cup.point(320, photo ? 300 : 306),
      plate,
      tray: photo ? 295 : 356,
    };
  }
  const api = { pose, scene };
  if (typeof module === "object" && module.exports) module.exports = api;
  else scope.BrewSceneLayout = api;
})(typeof window === "undefined" ? globalThis : window);
