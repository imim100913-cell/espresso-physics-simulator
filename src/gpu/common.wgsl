// SI units throughout. Particle layout: 9 vec4 = 144 bytes.
struct Params {
  counts: vec4<u32>,
  geom: vec4<f32>,
  material: vec4<f32>,
  clock: vec4<f32>,
  forcing: vec4<f32>,
  mass: vec4<f32>,
  porous: vec4<f32>,
  fluid: vec4<f32>,
}
struct Particle {
  xm:vec4<f32>, vv:vec4<f32>,
  c0:vec4<f32>, c1:vec4<f32>, c2:vec4<f32>,
  f0:vec4<f32>, f1:vec4<f32>, f2:vec4<f32>, plastic:vec4<f32>,
}
struct Cell {
  // bulk volume fractions and solute kg/m^3 of bulk volume
  state:vec4<f32>, // water, dissolved, porosity, permeability
  solid:vec4<f32>, // dry kg, remaining soluble kg, pressure Pa, active flag
  face:vec4<f32>, // outgoing x/y/z water m/s (positive direction)
  transfer:vec4<f32>, // admitted kg, discharged kg, discharged solute kg, dissolved kg
  momentum:vec4<f32>, // water momentum kg m/s; reserved
  reaction:vec4<f32>, // solid impulse, reciprocal fluid impulse is -xyz
}
struct Drop {
  xm:vec4<f32>, // position, kg (0 = inactive)
  oldLambda:vec4<f32>, // previous position, accumulated XPBD multiplier
  vc:vec4<f32>, // velocity, dissolved mass kg
  predicted:vec4<f32>,
}
fn hash(v:u32)->u32 {var x=v; x=((x>>16u)^x)*0x45d9f3bu;x=((x>>16u)^x)*0x45d9f3bu;return (x>>16u)^x;}
fn random(v:u32)->f32{return f32(hash(v)&0xffffffu)/16777216.;}
fn ident()->mat3x3<f32>{return mat3x3<f32>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));}
fn outer(a:vec3<f32>,b:vec3<f32>)->mat3x3<f32>{return mat3x3<f32>(a*b.x,a*b.y,a*b.z);}
fn index3(p:vec3<i32>,dim:u32)->u32{return u32(p.x)+dim*(u32(p.y)+dim*u32(p.z));}
fn coord3(i:u32,dim:u32)->vec3<i32>{return vec3<i32>(i32(i%dim),i32((i/dim)%dim),i32(i/(dim*dim)));}
fn inside(p:vec3<i32>,dim:u32)->bool{return all(p>=vec3<i32>(0))&&all(p<vec3<i32>(i32(dim)));}
fn weights(f:vec3<f32>)->mat3x3<f32>{return mat3x3<f32>(.5*(1.5-f)*(1.5-f),.75-(f-1.)*(f-1.),.5*(f-.5)*(f-.5));}
fn finite3(v:vec3<f32>)->bool{return all(abs(v)<vec3<f32>(1e20));}
