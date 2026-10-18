struct Camera {
  vp:mat4x4<f32>,view:mat4x4<f32>,inverseProjection:mat4x4<f32>,projection:mat4x4<f32>,
  screen:vec4<f32>,domain:vec4<f32>,optics:vec4<f32>,counts:vec4<u32>,
}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
@group(0) @binding(2) var<storage,read> cells:array<Cell>;
@group(0) @binding(3) var<storage,read> drops:array<Drop>;
fn world(x:vec3<f32>)->vec3<f32>{return vec3<f32>((x.x-camera.domain.x)*camera.domain.w,camera.domain.z+(x.y-camera.domain.y)*camera.domain.w,(x.z-camera.domain.x)*camera.domain.w);}
fn ndc(v:vec4<f32>)->vec4<f32>{return vec4<f32>(v.xy,(v.z+v.w)*.5,v.w);}
struct Varying {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) center:vec3<f32>,@location(2) radius:f32,@location(3) moisture:f32,@location(4) worldCenter:vec3<f32>}
fn corner(i:u32)->vec2<f32>{let a=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1));return a[i];}
@vertex
fn powderVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Varying {
  let q=particles[i];let r=pow(3.*q.vv.w/(4.*3.14159265),1./3.)*1.12*camera.domain.w;let w=world(q.xm.xyz);let center=(camera.view*vec4<f32>(w,1)).xyz;let xy=corner(vertex);
  let cell=clamp(vec3<i32>(floor(q.xm.xyz/camera.optics.z)),vec3<i32>(0),vec3<i32>(i32(camera.counts.y)-1));let a=cells[index3(cell,camera.counts.y)];
  var result:Varying;result.position=ndc(camera.projection*vec4<f32>(center+vec3<f32>(xy*r,0),1));result.uv=xy;result.center=center;result.radius=r;result.moisture=clamp(a.state.x/max(a.state.z,.01),0.,1.);result.worldCenter=w;return result;
}
struct Fragment {@location(0) color:vec4<f32>,@builtin(frag_depth) depth:f32}
@fragment
fn powderFragment(in:Varying)->Fragment {
  let r2=dot(in.uv,in.uv);if(r2>1.){discard;}let n=vec3<f32>(in.uv,sqrt(1.-r2));let sphere=in.center+n*in.radius;
  let rotation=transpose(mat3x3<f32>(camera.view[0].xyz,camera.view[1].xyz,camera.view[2].xyz));
  if(camera.screen.z>.5&&(in.worldCenter+rotation*n*in.radius).z>0.){discard;}
  let clip=camera.projection*vec4<f32>(sphere,1);let diffuse=.32+.68*max(0.,dot(n,normalize(vec3<f32>(-.3,.7,1.))));let base=mix(vec3<f32>(.30,.13,.045),vec3<f32>(.065,.025,.009),in.moisture);
  var result:Fragment;result.color=vec4<f32>(base*diffuse,1.);result.depth=(clip.z/clip.w+1.)*.5;return result;
}
@vertex
fn liquidVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Varying {
  let q=drops[i];let r=pow(3.*max(q.xm.w,0.)/(4.*3.14159265*1000.),1./3.)*camera.domain.w;let w=world(q.xm.xyz);let center=(camera.view*vec4<f32>(w,1)).xyz;let xy=corner(vertex);
  var result:Varying;result.position=ndc(camera.projection*vec4<f32>(center+vec3<f32>(xy*r,0),1));result.uv=xy;result.center=center;result.radius=r;result.moisture=q.vc.w/max(q.xm.w,1e-20);result.worldCenter=w;if(q.xm.w<=0.){result.position=vec4<f32>(2,2,2,1);}return result;
}
@fragment
fn liquidDepth(in:Varying)->Fragment {let r2=dot(in.uv,in.uv);if(r2>1.||in.radius<=0.){discard;}let surface=in.center+vec3<f32>(in.uv,sqrt(1.-r2))*in.radius;let clip=camera.projection*vec4<f32>(surface,1);var result:Fragment;result.color=vec4<f32>(-surface.z,in.moisture,0,1);result.depth=(clip.z/clip.w+1.)*.5;return result;}
@fragment
fn thickness(in:Varying)->@location(0) vec4<f32>{let r2=dot(in.uv,in.uv);if(r2>1.||in.radius<=0.){discard;}return vec4<f32>(2.*in.radius*sqrt(1.-r2),0,0,1);}
