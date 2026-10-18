@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(2) var<storage,read_write> heads:array<atomic<i32>>;
@group(0) @binding(3) var<storage,read_write> next:array<i32>;
@group(0) @binding(4) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(5) var<storage,read_write> pressure:array<f32>;
@group(0) @binding(6) var<storage,read_write> pool:array<vec4<f32>>;

fn isCell(c:vec3<i32>)->bool {return inside(c,p.counts.z)&&cells[index3(c,p.counts.z)].solid.w>.5;}
fn saturation(a:Cell)->f32{return clamp(a.state.x/max(a.state.z,.05),0.,1.);}
fn capillary(a:Cell)->f32{return -1200.*pow(1.-saturation(a),2.);}
fn mobility(a:Cell,b:Cell)->f32 {let k=2.*a.state.w*b.state.w/max(a.state.w+b.state.w,1e-25);return k*(.0001+.9999*.5*(pow(saturation(a),3.)+pow(saturation(b),3.)))/p.porous.w;}
@compute @workgroup_size(128)
fn clearBins(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<p.counts.z*p.counts.z*p.counts.z){atomicStore(&heads[i],-1);}}
@compute @workgroup_size(128)
fn bin(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=p.counts.x){return;}let xyz=clamp(vec3<i32>(floor(particles[i].xm.xyz/p.porous.x)),vec3<i32>(0),vec3<i32>(i32(p.counts.z)-1));next[i]=atomicExchange(&heads[index3(xyz,p.counts.z)],i32(i));}
@compute @workgroup_size(128)
fn initializeCells(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.z*p.counts.z*p.counts.z){return;}var mass=0.;var link=atomicLoad(&heads[i]);while(link>=0){mass+=particles[u32(link)].xm.w;link=next[u32(link)];}
  let volume=pow(p.porous.x,3.);let phi=clamp(1.-mass/(p.material.x*volume),.18,.72);
  let k=p.porous.z*pow(phi/.45,3.)*pow(.55/(1.-phi),2.);
  var a:Cell;a.state=vec4<f32>(0,0,phi,k);a.solid=vec4<f32>(mass,mass*.28,0.,select(0.,1.,mass>p.mass.x/f32(p.counts.x)*.1));
  a.face=vec4<f32>(0);a.transfer=vec4<f32>(0);a.momentum=vec4<f32>(0);a.reaction=vec4<f32>(0);cells[i]=a;pressure[i]=0.;
}
@compute @workgroup_size(128)
fn solvePressure(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;let dim=p.counts.z;if(i>=dim*dim*dim){return;}let xyz=coord3(i,dim);let a=cells[i];
  if(a.solid.w<.5){pressure[i]=0.;return;}
  if(saturation(a)<.98){pressure[i]=capillary(a);return;}
  var sum=0.;var coefficients=0.;
  let offsets=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
  for(var j=0u;j<6u;j++){
    let n=xyz+offsets[j];if(isCell(n)){let b=cells[index3(n,dim)];let coefficient=mobility(a,b);sum+=coefficient*(b.solid.z+1000.*p.forcing.x*f32(offsets[j].y)*p.porous.x);coefficients+=coefficient;}
    else if(j==2u){let coefficient=a.state.w/p.porous.w;sum+=coefficient*p.forcing.z;coefficients+=coefficient;}
    else if(j==3u&&f32(xyz.y)*p.porous.x<p.geom.w+p.porous.x){let coefficient=a.state.w/p.porous.w;coefficients+=coefficient;}
  }
  pressure[i]=select(capillary(a),sum/max(coefficients,1e-25),coefficients>0.);
}
@compute @workgroup_size(128)
fn copyPressure(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<p.counts.z*p.counts.z*p.counts.z){cells[i].solid.z=pressure[i];}}
@compute @workgroup_size(128)
fn flux(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;let dim=p.counts.z;if(i>=dim*dim*dim){return;}let xyz=coord3(i,dim);var a=cells[i];if(a.solid.w<.5){return;}var face=vec4<f32>(0);
  for(var axis=0u;axis<3u;axis++){
    var n=xyz;n[axis]+=1;
    if(isCell(n)){let b=cells[index3(n,dim)];let gravity=select(0.,1000.*p.forcing.x,axis==1u);face[axis]=-mobility(a,b)*((b.solid.z-a.solid.z)/p.porous.x+gravity);}
    else if(axis==1u&&pool[0].y<p.mass.z-1e-8){face.y=-a.state.w/p.porous.w*(p.forcing.z-a.solid.z)/(.5*p.porous.x);}
  }
  let below=xyz-vec3<i32>(0,1,0);
  if(!isCell(below)&&f32(xyz.y)*p.porous.x<p.geom.w+p.porous.x){face.w=max(0.,a.state.w/p.porous.w*a.solid.z/(.5*p.porous.x));}
  a.face=face;cells[i]=a;
}
fn exchange(axis:u32,parity:u32,i:u32){
  let dim=p.counts.z;if(i>=dim*dim*dim){return;}let xyz=coord3(i,dim);if(u32(xyz[axis])%2u!=parity||!isCell(xyz)){return;}var n=xyz;n[axis]+=1;if(!isCell(n)){return;}
  let j=index3(n,dim);var a=cells[i];var b=cells[j];let requested=a.face[axis]*p.forcing.y/p.porous.x;
  var amount=0.;var solute=0.;
  if(requested>=0.){amount=min(requested,min(a.state.x,max(0.,b.state.z-b.state.x)));solute=amount*a.state.y/max(a.state.x,1e-12);}
  else{amount=-min(-requested,min(b.state.x,max(0.,a.state.z-a.state.x)));solute=amount*b.state.y/max(b.state.x,1e-12);}
  a.state.x-=amount;b.state.x+=amount;a.state.y-=solute;b.state.y+=solute;cells[i]=a;cells[j]=b;
}
@compute @workgroup_size(128) fn x0(@builtin(global_invocation_id) id:vec3<u32>){exchange(0,0,id.x);}
@compute @workgroup_size(128) fn x1(@builtin(global_invocation_id) id:vec3<u32>){exchange(0,1,id.x);}
@compute @workgroup_size(128) fn y0(@builtin(global_invocation_id) id:vec3<u32>){exchange(1,0,id.x);}
@compute @workgroup_size(128) fn y1(@builtin(global_invocation_id) id:vec3<u32>){exchange(1,1,id.x);}
@compute @workgroup_size(128) fn z0(@builtin(global_invocation_id) id:vec3<u32>){exchange(2,0,id.x);}
@compute @workgroup_size(128) fn z1(@builtin(global_invocation_id) id:vec3<u32>){exchange(2,1,id.x);}
@compute @workgroup_size(1)
fn outletBudget(){
  let count=p.counts.z*p.counts.z*p.counts.z;var out=0.;
  for(var i=0u;i<count;i++){let a=cells[i];if(a.solid.w>.5){out+=min(a.face.w*p.forcing.y/p.porous.x,a.state.x)*pow(p.porous.x,3.)*(1000.+a.state.y/max(a.state.x,1e-12));}}
  pool[1].x=select(0.,min(1.,max(0.,p.mass.z-pool[0].y)/max(out,1e-20)),out>0.);
}
@compute @workgroup_size(128)
fn boundaries(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;let dim=p.counts.z;if(i>=dim*dim*dim){return;}let xyz=coord3(i,dim);var a=cells[i];if(a.solid.w<.5){return;}let volume=pow(p.porous.x,3.);
  if(!isCell(xyz+vec3<i32>(0,1,0))&&pool[0].y<p.mass.z-1e-8){let admitted=min(max(0.,-a.face.y*p.forcing.y/p.porous.x),max(0.,a.state.z-a.state.x));a.state.x+=admitted;a.transfer.x+=admitted*volume*1000.;}
  let drained=min(a.face.w*p.forcing.y/p.porous.x*pool[1].x,a.state.x);let solute=drained*a.state.y/max(a.state.x,1e-12);
  a.state.x-=drained;a.state.y-=solute;a.transfer.y+=drained*volume*1000.;a.transfer.z+=solute*volume;
  // Finite soluble reservoir, first-order approach to a saturation concentration.
  let liquidVolume=a.state.x*volume;let concentration=a.state.y/max(a.state.x,1e-12);let targetC=220.;
  let rate=.20*exp((p.forcing.w-366.15)*.025);
  let dissolved=min(a.solid.y,max(0.,targetC-concentration)*liquidVolume*(1.-exp(-rate*p.forcing.y)));
  a.solid.y-=dissolved;a.state.y+=dissolved/volume;a.transfer.w+=dissolved;a.reaction.w=dissolved;
  let v=vec3<f32>(a.face.x,a.face.y,a.face.z)/max(a.state.x,.02);a.momentum=vec4<f32>(v*(a.state.x*volume*1000.),0);cells[i]=a;
}

@compute @workgroup_size(128)
fn refreshCells(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.z*p.counts.z*p.counts.z){return;}var mass=0.;var soluble=0.;var link=atomicLoad(&heads[i]);while(link>=0){let q=particles[u32(link)];mass+=q.xm.w;soluble+=q.plastic.z;link=next[u32(link)];}
  var a=cells[i];let volume=pow(p.porous.x,3.);let phi=clamp(1.-mass/(p.material.x*volume),.18,.72);
  a.state.z=phi;a.state.w=p.porous.z*pow(phi/.45,3.)*pow(.55/(1.-phi),2.);
  a.solid.x=mass;a.solid.y=soluble;a.solid.w=select(0.,1.,mass>1e-12||a.state.x>1e-10);cells[i]=a;
}
@compute @workgroup_size(128)
fn dissolveParticles(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.x){return;}var q=particles[i];let c=clamp(vec3<i32>(floor(q.xm.xyz/p.porous.x)),vec3<i32>(0),vec3<i32>(i32(p.counts.z)-1));let a=cells[index3(c,p.counts.z)];
  let lost=min(q.plastic.z,a.reaction.w*q.plastic.z/max(a.solid.y+a.reaction.w,1e-20));q.plastic.z-=lost;q.xm.w-=lost;q.vv.w=q.xm.w/p.material.x;particles[i]=q;
}
