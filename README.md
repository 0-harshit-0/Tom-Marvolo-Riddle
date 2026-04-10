# fliptionary

## INSTALL & BUILD
- navigate to the /front dir.
- open terminal and install the modules:
` npm i `
- now, build using:
` npx webpack ` or ` npx webpack --watch ` to rebuild on changes.
- it will return a dir named "/dist" in the same folder. Open it and your site is ready to use.


## NOTES

### RAYCASTER
```js
raycaster.setFromCamera(mouse, camera);
const intersects = raycaster.intersectObject(plane);
```
Those two lines are how Three.js figures out, “When the user points the mouse here on the screen, which 3D object are they pointing at?” They work like shining an invisible laser from the camera through the mouse position into the scene.
​

What the two lines do
raycaster.setFromCamera(mouse, camera); sets up a ray (an imaginary straight line) that starts at the camera and goes forward through the spot where your mouse is pointing on the screen. The mouse value here is a special screen coordinate (called normalized device coordinates) that represents “this spot on the canvas.”
​

const intersects = raycaster.intersectObject(plane); then checks whether that ray hits the plane mesh. If it hits, Three.js returns a list of “hits” (intersections), usually with the closest hit first.
​

Think of it like this (diagram)
Imagine a camera in a video game, and you tap a spot on the screen: Three.js shoots a straight line into the world from the camera, through that screen spot, and sees what it touches first. The diagram shows the camera, the ray, and the point where the ray touches the plane. (see the generated image above)
​

What you get in intersects
If the ray doesn’t touch the plane, intersects will be an empty array ([]). If it does touch, intersects[0] is the first hit, and it includes useful info like the exact 3D position where the ray hit (intersects[0].point) and how far it was from the camera (intersects[0].distance).
