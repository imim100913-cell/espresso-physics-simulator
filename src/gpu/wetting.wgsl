// Conservative capillary wetting prototype, SI units. Not a coupled Darcy/MPM solver.
// cell = (water volume fraction phi*S, solute kg/m^3 bulk, porosity phi, relative mobility).
// Explicit 6-neighbor finite-volume update. Ping-pong buffers, one writer per cell.
struct Params { size:vec4<u32>, dx:f32, dt:f32, diffusivity:f32, inlet:f32, inletConcentration:f32, drain:f32, pad0:f32, pad1:f32 }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> cells:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> next:array<vec4<f32>>;
// Per-cell accepted boundary water and solute, for conservation diagnostics.
@group(0) @binding(3) var<storage,read_write> boundary:array<vec4<f32>>;
fn index(p:vec3<i32>)->u32{return u32(p.x)+params.size.x*(u32(p.y)+params.size.y*u32(p.z));}
@compute @workgroup_size(4,4,4)
fn step(@builtin(global_invocation_id) id:vec3<u32>){
  if(any(id>=params.size.xyz)){return;}
  let i=index(vec3<i32>(id));let a=cells[i];let phi=max(a.z,.05);let sat=a.x/phi;
  var water=a.x;var solute=a.y;
  let offsets=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
  for(var n=0u;n<6u;n++){
    let p=vec3<i32>(id)+offsets[n];if(any(p<vec3<i32>(0))||any(p>=vec3<i32>(params.size.xyz))){continue;}
    let b=cells[index(p)];let coefficient=params.diffusivity*min(phi,max(b.z,.05))*min(a.w,b.w);
    let flux=coefficient*(b.x/max(b.z,.05)-sat)*params.dt/(params.dx*params.dx);
    // Upwind concentration: equal/opposite fluxes carry the same mass to neighbors.
    let donor=select(a,b,flux>0.);let concentration=donor.y/max(donor.x,1e-8);
    water+=flux;solute+=flux*concentration;
  }
  var admitted=0.;var drained=0.;var drainedSolute=0.;
  if(id.y==params.size.y-1u){admitted=min(params.inlet*params.dt/params.dx,max(0.,phi-water));water+=admitted;solute+=admitted*params.inletConcentration;}
  if(id.y==0u){drained=min(params.drain*params.dt/params.dx,max(0.,water));drainedSolute=solute*drained/max(water,1e-8);water-=drained;solute-=drainedSolute;}
  next[i]=vec4<f32>(water,solute,phi,a.w);
  boundary[i]=vec4<f32>(admitted,drained,admitted*params.inletConcentration,drainedSolute);
}
