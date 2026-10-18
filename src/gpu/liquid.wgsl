@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(2) var<storage,read_write> drops:array<Drop>;
@group(0) @binding(3) var<storage,read_write> heads:array<atomic<i32>>;
@group(0) @binding(4) var<storage,read_write> next:array<i32>;
@group(0) @binding(5) var<storage,read_write> delta:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read_write> pool:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> cdf:array<f32>;
@group(0) @binding(8) var<storage,read_write> collected:array<vec4<f32>>;

fn fcoord(x:vec3<f32>)->vec3<i32>{return vec3<i32>(floor((x+vec3<f32>(0,.08,0))/p.fluid.x));}
fn findex(c:vec3<i32>)->u32{return u32(c.x)+16u*(u32(c.y)+40u*u32(c.z));}
fn fvalid(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(16,40,16));}
fn kernel(d:vec3<f32>)->f32{let r2=dot(d,d);let h=p.fluid.x;if(r2>=h*h){return 0.;}let a=h*h-r2;return 315./(64.*3.14159265*pow(h,9.))*a*a*a;}
fn gradient(d:vec3<f32>)->vec3<f32>{let h=p.fluid.x;let a=max(0.,h*h-dot(d,d));return -945./(32.*3.14159265*pow(h,9.))*a*a*d;}
@compute @workgroup_size(128)
fn initialize(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<p.counts.w){var d:Drop;d.xm=vec4<f32>(0);d.oldLambda=vec4<f32>(0);d.vc=vec4<f32>(0);d.predicted=vec4<f32>(0);drops[i]=d;collected[i]=vec4<f32>(0);}if(i<16u*40u*16u){atomicStore(&heads[i],-1);}if(i<16u){pool[i]=vec4<f32>(0);}}
@compute @workgroup_size(1)
fn prepareEmission(){
  let n=p.counts.z*p.counts.z*p.counts.z;var input=0.;var waterOut=0.;var soluteOut=0.;var dissolved=0.;var storedWater=0.;var storedSolute=0.;var soluble=0.;var solidMass=0.;
  var cumulative=0.;var phi=0.;var activeCells=0.;var fluxSum=0.;var fluxSquare=0.;var outlets=0.;
  for(var i=0u;i<n;i++){let a=cells[i];if(a.solid.x>0.){phi+=a.state.z;activeCells+=1.;}if(a.face.w>0.){fluxSum+=a.face.w;fluxSquare+=a.face.w*a.face.w;outlets+=1.;}input+=a.transfer.x;waterOut+=a.transfer.y;soluteOut+=a.transfer.z;dissolved+=a.transfer.w;storedWater+=a.state.x*pow(p.porous.x,3.)*1000.;storedSolute+=a.state.y*pow(p.porous.x,3.);soluble+=a.solid.y;solidMass+=a.solid.x;cumulative+=a.transfer.y+a.transfer.z;cdf[i]=cumulative;}
  let out=waterOut+soluteOut;let newWater=max(0.,waterOut-pool[0].y+pool[0].z);let newSolute=max(0.,soluteOut-pool[0].z);
  pool[2].x+=newWater+newSolute;pool[2].y+=newSolute;
  pool[0]=vec4<f32>(input,out,soluteOut,dissolved);
  pool[3]=vec4<f32>(storedWater,storedSolute,soluble,solidMass);
  var cup=0.;var cupSolute=0.;var activeMass=0.;var activeSolute=0.;var freeSlots=0u;var bad=0.;
  for(var i=0u;i<p.counts.w;i++){bad+=collected[i].z;cup+=collected[i].x;cupSolute+=collected[i].y;let d=drops[i];activeMass+=d.xm.w;activeSolute+=d.vc.w;if(d.xm.w<=0.){freeSlots++;}}
  pool[4]=vec4<f32>(cup,cupSolute,activeMass,activeSolute);pool[6]=vec4<f32>(bad,phi/max(activeCells,1.),select(0.,clamp((sqrt(max(0.,fluxSquare/max(outlets,1.)-pow(fluxSum/max(outlets,1.),2.)))/max(fluxSum/max(outlets,1.),1e-12))*35.,0.,95.),outlets>1.),0);
  let finished=out>=p.mass.z-1e-8||p.porous.y>.5;let required=select(u32(floor(pool[2].x/p.fluid.y)),u32(ceil(pool[2].x/p.fluid.y)),finished);
  pool[5]=vec4<f32>(f32(min(required,freeSlots)),select(p.fluid.y,max(0.,pool[2].x-f32(max(1u,required)-1u)*p.fluid.y),finished&&required>0u),f32(required),0.);
  // Atomic integer ticket allocator uses an otherwise unused grid head.
  atomicStore(&heads[16u*40u*16u],0);
}
@compute @workgroup_size(128)
fn emit(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w>0.||pool[5].x<1.){return;}let ticket=u32(atomicAdd(&heads[16u*40u*16u],1));if(ticket>=u32(pool[5].x)){return;}
  let count=p.counts.z*p.counts.z*p.counts.z;let total=cdf[count-1u];let threshold=random(i*19u+u32(p.clock.y*1e7))*total;var lo=0u;var hi=count-1u;while(lo<hi){let mid=(lo+hi)/2u;if(cdf[mid]<threshold){lo=mid+1u;}else{hi=mid;}}
  let xyz=coord3(lo,p.counts.z);let waterMass=select(p.fluid.y,pool[5].y,ticket+1u==u32(pool[5].z));let ratio=pool[2].y/max(pool[2].x,1e-20);
  var d:Drop;let center=(vec3<f32>(xyz)+.5)*p.porous.x;
  d.xm=vec4<f32>(center.x+(random(i*23u+1u)-.5)*p.porous.x*.6,p.geom.w-.0006,center.z+(random(i*23u+2u)-.5)*p.porous.x*.6,waterMass);
  d.oldLambda=vec4<f32>(d.xm.xyz,0);d.vc=vec4<f32>(0,-.025,0,waterMass*ratio);d.predicted=vec4<f32>(d.xm.xyz,0);drops[i]=d;
}
@compute @workgroup_size(1)
fn finishEmission(){let made=u32(pool[5].x);var spent=f32(made)*p.fluid.y;if(made>0u&&made==u32(pool[5].z)){spent=f32(made-1u)*p.fluid.y+pool[5].y;}let ratio=pool[2].y/max(pool[2].x,1e-20);pool[2].x=max(0.,pool[2].x-spent);pool[2].y=max(0.,pool[2].y-spent*ratio);}
@compute @workgroup_size(128)
fn clear(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<16u*40u*16u){atomicStore(&heads[id.x],-1);}}
@compute @workgroup_size(128)
fn bin(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}let c=fcoord(drops[i].predicted.xyz);if(fvalid(c)){next[i]=atomicExchange(&heads[findex(c)],i32(i));}else{next[i]=-1;}}
@compute @workgroup_size(128)
fn predict(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}var d=drops[i];let dt=p.mass.w;d.oldLambda=vec4<f32>(d.xm.xyz,0);let v=d.vc.xyz+vec3<f32>(0,-p.forcing.x*dt,0);d.predicted=vec4<f32>(d.xm.xyz+v*dt,0);drops[i]=d;
}
@compute @workgroup_size(128)
fn density(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}let d=drops[i];let c=fcoord(d.predicted.xyz);var rho=d.xm.w*kernel(vec3<f32>(0));var gradSelf=vec3<f32>(0);var denominator=0.;
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let b=c+vec3<i32>(x,y,z);if(!fvalid(b)){continue;}var link=atomicLoad(&heads[findex(b)]);while(link>=0){let j=u32(link);let q=drops[j];if(j!=i&&q.xm.w>0.){let difference=d.predicted.xyz-q.predicted.xyz;if(dot(difference,difference)<p.fluid.x*p.fluid.x){rho+=q.xm.w*kernel(difference);let grad=q.xm.w/1000.*gradient(difference);gradSelf+=grad;denominator+=dot(grad,grad)/q.xm.w;}}link=next[j];}}}}
  denominator+=dot(gradSelf,gradSelf)/d.xm.w;let constraint=max(-.15,rho/1000.-1.);let alpha=p.fluid.z/(p.mass.w*p.mass.w);let dl=(-constraint-alpha*d.oldLambda.w)/max(denominator+alpha,1e-8);drops[i].oldLambda.w=d.oldLambda.w+dl;drops[i].predicted.w=dl;
}
@compute @workgroup_size(128)
fn correction(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}let d=drops[i];let c=fcoord(d.predicted.xyz);var correction=vec3<f32>(0);
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let b=c+vec3<i32>(x,y,z);if(!fvalid(b)){continue;}var link=atomicLoad(&heads[findex(b)]);while(link>=0){let j=u32(link);let q=drops[j];if(j!=i&&q.xm.w>0.){let difference=d.predicted.xyz-q.predicted.xyz;if(dot(difference,difference)<p.fluid.x*p.fluid.x){correction+=(q.xm.w*d.predicted.w+d.xm.w*q.predicted.w)/1000.*gradient(difference);}}link=next[j];}}}}
  delta[i]=vec4<f32>(correction/d.xm.w,0);
}
@compute @workgroup_size(128)
fn apply(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}var d=drops[i];let displacement=delta[i].xyz;d.predicted=vec4<f32>(d.predicted.xyz+displacement,0);
  // Cup is an explicit conical SDF, opening wider than the filter.
  let bottom=p.fluid.w;let mouth=bottom+.026;let radial=d.predicted.xz-vec2<f32>(p.geom.y);let r=length(radial);
  if(d.predicted.y<mouth&&d.predicted.y>bottom){let radius=mix(.018,.030,clamp((d.predicted.y-bottom)/.026,0.,1.));if(r>radius){let n=radial/max(r,1e-8);d.predicted.x=p.geom.y+n.x*radius;d.predicted.z=p.geom.y+n.y*radius;}}
  drops[i]=d;
}
// Pairwise viscosity and cohesion use immutable predicted/previous positions.
// For each pair m_i*a_ij = -m_j*a_ji, before external cup contacts.
@compute @workgroup_size(128)
fn surface(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}let d=drops[i];let c=fcoord(d.predicted.xyz);let h=p.fluid.x;
  let vi=(d.predicted.xyz-d.oldLambda.xyz)/p.mass.w;var acceleration=vec3<f32>(0);
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let b=c+vec3<i32>(x,y,z);if(!fvalid(b)){continue;}var link=atomicLoad(&heads[findex(b)]);while(link>=0){let j=u32(link);let q=drops[j];if(j!=i&&q.xm.w>0.){let difference=d.predicted.xyz-q.predicted.xyz;let r=length(difference);if(r>1e-7&&r<h){let vj=(q.predicted.xyz-q.oldLambda.xyz)/p.mass.w;let volume=q.xm.w/1000.;let laplacian=45./(3.14159265*pow(h,6.))*(h-r);acceleration+=3e-6*volume*laplacian*(vj-vi);acceleration-=.045/1000.*volume*15./(3.14159265*pow(h,5.))*pow(1.-r/h,2.)*difference/r;}}link=next[j];}}}}
  delta[i]=vec4<f32>(vi+acceleration*p.mass.w,0);
}
@compute @workgroup_size(128)
fn finish(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.w||drops[i].xm.w<=0.){return;}var d=drops[i];let dt=p.mass.w;var v=delta[i].xyz;
  if(!finite3(v)){v=vec3<f32>(0);d.predicted=vec4<f32>(d.oldLambda.xyz,0);collected[i].z+=1.;}
  d.vc=vec4<f32>(v,d.vc.w);d.xm=vec4<f32>(d.predicted.xyz,d.xm.w);
  if(d.xm.y<=p.fluid.w){collected[i].x+=d.xm.w;collected[i].y+=d.vc.w;d.xm.w=0.;d.vc=vec4<f32>(0);}
  drops[i]=d;
}
