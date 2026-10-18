struct Camera {vp:mat4x4<f32>,view:mat4x4<f32>,inverseProjection:mat4x4<f32>,projection:mat4x4<f32>,screen:vec4<f32>,domain:vec4<f32>,optics:vec4<f32>,counts:vec4<u32>}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var base:texture_2d<f32>;
@group(1) @binding(1) var depths:texture_2d<f32>;
@group(1) @binding(2) var thickness:texture_2d<f32>;
@vertex fn quad(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{let a=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(a[i],0,1);}
fn pixel(x:vec2<i32>)->vec2<i32>{return clamp(x,vec2<i32>(0),vec2<i32>(camera.screen.xy)-1);}
@fragment fn copy(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{return textureLoad(base,pixel(vec2<i32>(p.xy)),0);}
fn viewPoint(x:vec2<i32>,depth:f32)->vec3<f32>{let uv=(vec2<f32>(x)+.5)/camera.screen.xy;let ray=camera.inverseProjection*vec4<f32>(uv.x*2.-1.,1.-uv.y*2.,1,1);return ray.xyz*(-depth/ray.z);}
@fragment fn bilateral(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
  let xy=vec2<i32>(p.xy);let middle=textureLoad(depths,pixel(xy),0);if(middle.x<=0.){return vec4<f32>(0);}
  var sum=vec2<f32>(0);var weights=0.;
  for(var i=-4;i<=4;i++){let direction=vec2<i32>(AXIS_X,AXIS_Y);let z=textureLoad(depths,pixel(xy+direction*i),0);if(z.x<=0.){continue;}let dz=(z.x-middle.x)/.04;let w=exp(-f32(i*i)/8.-dz*dz*.5);sum+=z.xy*w;weights+=w;}
  return vec4<f32>(sum/max(weights,1e-8),0,1);
}
fn linear(c:vec3<f32>)->vec3<f32>{return pow(max(c,vec3<f32>(0)),vec3<f32>(2.2));}
@fragment fn composite(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
  let xy=vec2<i32>(p.xy);let original=textureLoad(base,pixel(xy),0);let z=textureLoad(depths,pixel(xy),0);if(z.x<=0.){return original;}
  let center=viewPoint(xy,z.x);let zx=textureLoad(depths,pixel(xy+vec2<i32>(1,0)),0).x;let zy=textureLoad(depths,pixel(xy+vec2<i32>(0,1)),0).x;
  let dx=viewPoint(xy+vec2<i32>(1,0),select(z.x,zx,zx>0.))-center;let dy=viewPoint(xy+vec2<i32>(0,1),select(z.x,zy,zy>0.))-center;
  var normal=normalize(cross(dx,dy));if(normal.z<0.){normal=-normal;}let view=normalize(-center);let fresnel=.0204+.9796*pow(1.-max(0.,dot(normal,view)),5.);
  let path=textureLoad(thickness,pixel(xy),0).x/camera.domain.w;
  let transmittance=exp(-vec3<f32>(1000.,3500.,6500.)*(z.y/.10)*path);
  let offset=vec2<i32>(normal.xy*vec2<f32>(1,-1)*camera.screen.xy*.008);
  let transmitted=linear(textureLoad(base,pixel(xy+offset),0).rgb)*transmittance;
  let reflectance=vec3<f32>(.5,.53,.48)*(.2+.8*pow(max(0.,dot(reflect(-view,normal),normalize(vec3<f32>(1,2,3)))),16.));
  return vec4<f32>(pow(max(mix(transmitted,reflectance,fresnel),vec3<f32>(0)),vec3<f32>(1./2.2)),1);
}
