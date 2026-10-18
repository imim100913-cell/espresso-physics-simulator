@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(2) var<storage,read_write> heads:array<atomic<i32>>;
@group(0) @binding(3) var<storage,read_write> next:array<i32>;
@group(0) @binding(4) var<storage,read_write> grid:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(6) var<storage,read_write> diagnostics:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> impulses:array<vec4<f32>>;

@compute @workgroup_size(128)
fn initialize(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.x){return;}
  let a=random(i*3u+11u)*6.2831853;let r=sqrt(random(i*3u+12u))*p.geom.z*.90;
  var q:Particle;q.xm=vec4<f32>(p.geom.y+cos(a)*r,p.geom.w+.006+random(i*3u+13u)*.012,p.geom.y+sin(a)*r,p.mass.x/f32(p.counts.x));
  q.vv=vec4<f32>(0.,0.,0.,q.xm.w/p.material.x);
  q.c0=vec4<f32>(0);q.c1=vec4<f32>(0);q.c2=vec4<f32>(0);
  q.f0=vec4<f32>(1,0,0,0);q.f1=vec4<f32>(0,1,0,0);q.f2=vec4<f32>(0,0,1,0);q.plastic=vec4<f32>(1,0,q.xm.w*.28,0);particles[i]=q;
}
@compute @workgroup_size(128)
fn clearGrid(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<p.counts.y*p.counts.y*p.counts.y){atomicStore(&heads[i],-1);grid[i]=vec4<f32>(0);impulses[i]=vec4<f32>(0);}}
@compute @workgroup_size(128)
fn binParticles(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=p.counts.x){return;}let cell=clamp(vec3<i32>(floor(particles[i].xm.xyz/p.geom.x-.5)),vec3<i32>(0),vec3<i32>(i32(p.counts.y)-1));next[i]=atomicExchange(&heads[index3(cell,p.counts.y)],i32(i));}
struct Eigen {a:mat3x3<f32>,v:mat3x3<f32>}
fn rotate(e:Eigen,i:u32,j:u32)->Eigen {
  if(abs(e.a[j][i])<1e-10){return e;}
  let tau=(e.a[j][j]-e.a[i][i])/(2.*e.a[j][i]);
  let t=select(-1.,1.,tau>=0.)/(abs(tau)+sqrt(1.+tau*tau));let c=inverseSqrt(1.+t*t);let s=t*c;
  var r=ident();r[i][i]=c;r[j][j]=c;r[i][j]=-s;r[j][i]=s;
  var result:Eigen;result.a=transpose(r)*e.a*r;result.v=e.v*r;return result;
}
@compute @workgroup_size(128)
fn constitutive(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.x){return;}var q=particles[i];
  let C=mat3x3<f32>(q.c0.xyz,q.c1.xyz,q.c2.xyz);
  var F=(ident()+p.clock.x*C)*mat3x3<f32>(q.f0.xyz,q.f1.xyz,q.f2.xyz);
  if(!finite3(F[0])||!finite3(F[1])||!finite3(F[2])||determinant(F)<=0.){F=ident();q.plastic.w+=1.;}
  var e:Eigen;e.a=transpose(F)*F;e.v=ident();
  for(var sweep=0u;sweep<5u;sweep++){e=rotate(e,0,1);e=rotate(e,0,2);e=rotate(e,1,2);}
  let B=F*e.v;let sigma=max(vec3<f32>(length(B[0]),length(B[1]),length(B[2])),vec3<f32>(1e-5));
  let U=mat3x3<f32>(B[0]/sigma.x,B[1]/sigma.y,B[2]/sigma.z);
  let trial=log(clamp(sigma,vec3<f32>(.02),vec3<f32>(20.)));let trace=trial.x+trial.y+trial.z;let dev=trial-vec3<f32>(trace/3.);let norm=length(dev);
  var strain=trial;
  // Log-strain Drucker-Prager return map with tension cutoff (cohesionless sand).
  if(trace>=0.){strain=vec3<f32>(0.);}else{
    let limit=-(3.*p.material.z+2.*p.material.y)/(2.*p.material.y)*p.material.w*trace;
    if(norm>limit){strain=dev*(limit/max(norm,1e-8))+vec3<f32>(trace/3.);}
  }
  let projectedTrace=strain.x+strain.y+strain.z;
  q.plastic.x=clamp(q.plastic.x*exp(trace-projectedTrace),.2,5.);
  q.plastic.y+=length(trial-strain);
  let Fe=U*mat3x3<f32>(vec3<f32>(exp(strain.x),0,0),vec3<f32>(0,exp(strain.y),0),vec3<f32>(0,0,exp(strain.z)))*transpose(e.v);
  q.f0=vec4<f32>(Fe[0],0);q.f1=vec4<f32>(Fe[1],0);q.f2=vec4<f32>(Fe[2],0);
  let stress=2.*p.material.y*strain+vec3<f32>(p.material.z*projectedTrace);
  let tau=U*mat3x3<f32>(vec3<f32>(stress.x,0,0),vec3<f32>(0,stress.y,0),vec3<f32>(0,0,stress.z))*transpose(U);
  let affine=q.xm.w*C-(4.*p.clock.x*q.vv.w/(p.geom.x*p.geom.x))*tau;
  q.c0=vec4<f32>(affine[0],0);q.c1=vec4<f32>(affine[1],0);q.c2=vec4<f32>(affine[2],0);particles[i]=q;
}
@compute @workgroup_size(64)
fn gather(@builtin(global_invocation_id) id:vec3<u32>){
  let node=id.x;let dim=p.counts.y;if(node>=dim*dim*dim){return;}let xyz=coord3(node,dim);let nodePos=vec3<f32>(xyz)*p.geom.x;
  var mass=0.;var momentum=vec3<f32>(0.);
  // Each grid node has one writer; linked bins avoid non-portable float atomics.
  for(var z=-2;z<=0;z++){for(var y=-2;y<=0;y++){for(var x=-2;x<=0;x++){
    let bin=xyz+vec3<i32>(x,y,z);if(!inside(bin,dim)){continue;}
    var link=atomicLoad(&heads[index3(bin,dim)]);
    while(link>=0){let q=particles[u32(link)];let base=vec3<i32>(floor(q.xm.xyz/p.geom.x-.5));let d=xyz-base;
      if(all(d>=vec3<i32>(0))&&all(d<=vec3<i32>(2))){let w=weights(q.xm.xyz/p.geom.x-vec3<f32>(base));let weight=w[u32(d.x)].x*w[u32(d.y)].y*w[u32(d.z)].z;
        momentum+=weight*(q.xm.w*q.vv.xyz+mat3x3<f32>(q.c0.xyz,q.c1.xyz,q.c2.xyz)*(nodePos-q.xm.xyz));mass+=weight*q.xm.w;
      }link=next[u32(link)];
    }
  }}}
  if(mass>1e-12){var v=momentum/mass;v.y-=p.clock.x*p.forcing.x;
    let hc=clamp(vec3<i32>(floor(nodePos/p.porous.x)),vec3<i32>(0),vec3<i32>(i32(p.counts.z)-1));let hi=index3(hc,p.counts.z);let cell=cells[hi];
    let mwCell=cell.state.x*pow(p.porous.x,3.)*1000.;let mw=mwCell/pow(p.porous.x/p.geom.x,3.);
    if(mw>1e-12 && cell.state.w>0.){
      let u=cell.momentum.xyz/max(mwCell,1e-12);let beta=p.porous.w/max(cell.state.w,1e-20)*pow(p.geom.x,3.)*cell.state.x;
      let relative=u-v;let after=relative/(1.+p.clock.x*beta*(1./mass+1./mw));
      let delta=(relative-after)*(mw/(mass+mw));v+=delta;impulses[node]=vec4<f32>(mass*delta,0.);
    }
    let radial=nodePos.xz-vec2<f32>(p.geom.y);let r=length(radial);if(r>p.geom.z-p.geom.x){let n=radial/max(r,1e-8);let outward=max(0.,dot(v.xz,n));v.x-=n.x*outward;v.z-=n.y*outward;}
    if(nodePos.y<p.geom.w+p.geom.x && v.y<0.){let friction=max(0.,1.-.4*abs(v.y)/max(length(v.xz),1e-8));v.x*=friction;v.z*=friction;v.y=0.;}
    if(nodePos.y>p.clock.z-p.geom.x && v.y>p.clock.w){v.y=p.clock.w;v.x*=.9;v.z*=.9;}
    grid[node]=vec4<f32>(v,mass);
  }else{grid[node]=vec4<f32>(0);}
}
@compute @workgroup_size(128)
fn g2p(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=p.counts.x){return;}var q=particles[i];let base=vec3<i32>(floor(q.xm.xyz/p.geom.x-.5));let fx=q.xm.xyz/p.geom.x-vec3<f32>(base);let w=weights(fx);var v=vec3<f32>(0);var C=mat3x3<f32>(vec3<f32>(0),vec3<f32>(0),vec3<f32>(0));
  for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){let node=base+vec3<i32>(x,y,z);if(!inside(node,p.counts.y)){continue;}let weight=w[u32(x)].x*w[u32(y)].y*w[u32(z)].z;let gv=grid[index3(node,p.counts.y)].xyz;v+=weight*gv;C+=4.*weight/p.geom.x*outer(gv,vec3<f32>(f32(x),f32(y),f32(z))-fx);}}}
  if(!finite3(v)){v=vec3<f32>(0);q.plastic.w+=1.;}
  q.vv=vec4<f32>(v,q.vv.w);q.xm=vec4<f32>(q.xm.xyz+p.clock.x*v,q.xm.w);
  let radial=q.xm.xz-vec2<f32>(p.geom.y);let r=length(radial);if(r>p.geom.z-.0003){let n=radial/max(r,1e-8);q.xm.x=p.geom.y+n.x*(p.geom.z-.0003);q.xm.z=p.geom.y+n.y*(p.geom.z-.0003);}
  q.xm.y=clamp(q.xm.y,p.geom.w+.0002,max(p.geom.w+.0003,p.clock.z-.0002));
  q.c0=vec4<f32>(C[0],0);q.c1=vec4<f32>(C[1],0);q.c2=vec4<f32>(C[2],0);particles[i]=q;
}
var<workgroup> dm:array<vec4<f32>,128>;
var<workgroup> db:array<vec4<f32>,128>;
@compute @workgroup_size(128)
fn reduce(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) local:u32,@builtin(workgroup_id) block:vec3<u32>){
  let i=gid.x;var a=vec4<f32>(0);var b=vec4<f32>(0,1e20,0,0);
  if(i<p.counts.x){let q=particles[i];a=vec4<f32>(q.xm.w,q.xm.y*q.xm.w,q.plastic.y*q.xm.w,length(q.vv.xyz));b=vec4<f32>(q.plastic.w,determinant(mat3x3<f32>(q.f0.xyz,q.f1.xyz,q.f2.xyz)),q.xm.w*q.vv.x,q.xm.w*q.vv.y);}
  dm[local]=a;db[local]=b;workgroupBarrier();
  for(var stride=64u;stride>0u;stride/=2u){if(local<stride){let av=dm[local+stride];dm[local]=vec4<f32>(dm[local].xyz+av.xyz,max(dm[local].w,av.w));let bv=db[local+stride];db[local]=vec4<f32>(db[local].x+bv.x,min(db[local].y,bv.y),db[local].zw+bv.zw);}workgroupBarrier();}
  if(local==0u){diagnostics[block.x*2u]=dm[0];diagnostics[block.x*2u+1u]=db[0];}
}

@compute @workgroup_size(128)
fn dragFeedback(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;let dim=p.counts.z;if(i>=dim*dim*dim){return;}let xyz=coord3(i,dim);let ratio=i32(round(p.porous.x/p.geom.x));var impulse=vec3<f32>(0.);
  for(var z=0;z<ratio;z++){for(var y=0;y<ratio;y++){for(var x=0;x<ratio;x++){let node=xyz*ratio+vec3<i32>(x,y,z);if(inside(node,p.counts.y)){impulse+=impulses[index3(node,p.counts.y)].xyz;}}}}
  cells[i].momentum=vec4<f32>(cells[i].momentum.xyz-impulse,0.);cells[i].reaction=vec4<f32>(impulse,cells[i].reaction.w);
}
