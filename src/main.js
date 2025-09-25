(function(){
  const canvas=document.getElementById('c');
  const ctx=canvas.getContext('2d');
  const state={pts:[],closed:false};
  const defaultShape=[
    {x:470,y:250},
    {x:560,y:210},
    {x:660,y:220},
    {x:750,y:290},
    {x:790,y:400},
    {x:760,y:520},
    {x:670,y:600},
    {x:560,y:620},
    {x:470,y:560},
    {x:420,y:460},
    {x:430,y:360}
  ];

  // Mode plumbing
  const modeSel=document.getElementById('mode');
  const autoRun=document.getElementById('autoRun');
  const panels={
    hatch:document.getElementById('panel-hatch'),
    contours:document.getElementById('panel-contours'),
    flow:document.getElementById('panel-flow'),
    guided:document.getElementById('panel-guided'),
    skinFlow:document.getElementById('panel-skinFlow'),
    noise:document.getElementById('panel-noise'),
    noiseDashed:document.getElementById('panel-noiseDashed')
  };
  function showPanel(){ document.querySelectorAll('.mode-panel').forEach(fs=>fs.classList.add('hidden')); const p=panels[modeSel.value]; if(p) p.classList.remove('hidden'); }
  function runSelected(){ switch(modeSel.value){ case 'hatch': return applyHatch(); case 'contours': return drawContours(); case 'flow': return drawFlow(); case 'guided': return drawGuidedFlow(); case 'skinFlow': return drawSkinFlow(); case 'noise': return drawNoiseFlow(); case 'noiseDashed': return drawNoiseDashedFlow(); } }
  document.getElementById('btn-run').onclick=()=>{ if(state.closed) runSelected(); };
  modeSel.addEventListener('change',()=>{ showPanel(); if(state.closed && autoRun.checked) runSelected(); });
  showPanel();

  // Debounced auto-run for control changes
  const controlRoot=document.getElementById('controls');
  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
  const auto=debounce(()=>{ if(state.closed && autoRun.checked) runSelected(); }, 120);
  controlRoot.addEventListener('input',(e)=>{ const p=panels[modeSel.value]; if(p && p.contains(e.target)) auto(); });
  controlRoot.addEventListener('change',(e)=>{ const p=panels[modeSel.value]; if(p && p.contains(e.target)) auto(); });

  // Drag-to-adjust for numeric inputs
  const dragNumState={active:false,input:null,startValue:0,startX:0,startY:0,pointerId:null,step:1,min:-Infinity,max:Infinity,moved:false,lastValue:null};
  const dragVertex={active:false,index:-1,pointerId:null,offsetX:0,offsetY:0};
  controlRoot.addEventListener('pointerdown',(e)=>{
    if(e.button!==0) return;
    const input=e.target.closest('input[type="number"]');
    if(!input || dragNumState.active) return;
    dragNumState.active=true;
    dragNumState.input=input;
    dragNumState.pointerId=e.pointerId;
    dragNumState.startX=e.clientX;
    dragNumState.startY=e.clientY;
    const current=parseFloat(input.value);
    dragNumState.startValue=Number.isFinite(current)?current:0;
    const step=parseFloat(input.step);
    dragNumState.step=Number.isFinite(step) && step>0 ? step : 1;
    const minAttr=input.min===''? null : parseFloat(input.min);
    const maxAttr=input.max===''? null : parseFloat(input.max);
    dragNumState.min=Number.isFinite(minAttr)? minAttr : -Infinity;
    dragNumState.max=Number.isFinite(maxAttr)? maxAttr : Infinity;
    dragNumState.moved=false;
    dragNumState.lastValue=null;
    input.focus({preventScroll:true});
    if(typeof input.setPointerCapture==='function'){
      try{ input.setPointerCapture(e.pointerId); }catch(_err){}
    }
  });

  function snapToStep(val,step){ if(!Number.isFinite(step) || step<=0) return val; const precision=Math.max(0,(step.toString().split('.')[1]||'').length); const snapped=Math.round(val/step)*step; return precision? +snapped.toFixed(precision) : snapped; }
  function clamp(val,min,max){ if(Number.isFinite(min) && val<min) return min; if(Number.isFinite(max) && val>max) return max; return val; }

  function updateDragValue(e){ const s=dragNumState; if(!s.active || e.pointerId!==s.pointerId || !s.input) return; const delta=s.startY - e.clientY; if(!s.moved && Math.abs(delta)<3) return; if(!s.moved){ s.moved=true; document.body.classList.add('dragging-number'); }
    let sensitivity=0.35; if(e.shiftKey) sensitivity=0.08; else if(e.altKey || e.metaKey) sensitivity=0.02; else if(e.ctrlKey) sensitivity=0.65;
    let candidate=s.startValue + delta * s.step * sensitivity;
    candidate=snapToStep(candidate, s.step);
    candidate=clamp(candidate,s.min,s.max);
    if(candidate===s.lastValue) return;
    s.lastValue=candidate;
    s.input.value=String(candidate);
    s.input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function endDrag(e){ const s=dragNumState; if(!s.active || e.pointerId!==s.pointerId || !s.input) return; if(typeof s.input.releasePointerCapture==='function'){ try{ if(typeof s.input.hasPointerCapture==='function'){ if(s.input.hasPointerCapture(e.pointerId)) s.input.releasePointerCapture(e.pointerId); } else { s.input.releasePointerCapture(e.pointerId); } }catch(_err){} }
    if(s.moved){ s.input.dispatchEvent(new Event('change',{bubbles:true})); }
    document.body.classList.remove('dragging-number');
    s.active=false; s.input=null; s.pointerId=null; s.lastValue=null; s.moved=false; s.startValue=0; s.step=1; s.min=-Infinity; s.max=Infinity; s.startX=0; s.startY=0; }
  window.addEventListener('pointermove',updateDragValue);
  window.addEventListener('pointerup',endDrag);
  window.addEventListener('pointercancel',endDrag);

  function canvasPoint(e){ const r=canvas.getBoundingClientRect(); const scaleX=canvas.width/r.width; const scaleY=canvas.height/r.height; return { x:(e.clientX-r.left)*scaleX, y:(e.clientY-r.top)*scaleY }; }
  function hitVertex(x,y,radius=14){ const rad2=radius*radius; for(let i=0;i<state.pts.length;i++){ const p=state.pts[i]; const dx=x-p.x, dy=y-p.y; if(dx*dx+dy*dy<=rad2) return i; } return -1; }
  function setShape(points){ state.pts=points.map(p=>({x:p.x,y:p.y})); state.closed=state.pts.length>=3; }

  // Drawing interactions
  canvas.addEventListener('pointerdown',(e)=>{ if(e.button!==0) return; const {x,y}=canvasPoint(e); const idx=hitVertex(x,y);
    if(idx>=0){ dragVertex.active=true; dragVertex.index=idx; dragVertex.pointerId=e.pointerId; dragVertex.offsetX=state.pts[idx].x - x; dragVertex.offsetY=state.pts[idx].y - y; if(typeof canvas.setPointerCapture==='function'){ try{ canvas.setPointerCapture(e.pointerId); }catch(_err){} } e.preventDefault(); return; }
    if(state.closed){ state.closed=false; state.pts.push({x,y}); state.closed=state.pts.length>=3; render(); if(state.closed && autoRun.checked) runSelected(); return; }
    state.pts.push({x,y}); if(state.pts.length>=3){ state.closed=true; render(); if(autoRun.checked) runSelected(); } else { render(); } });
  window.addEventListener('pointermove',(e)=>{ if(!dragVertex.active || e.pointerId!==dragVertex.pointerId) return; const {x,y}=canvasPoint(e); const idx=dragVertex.index; if(idx<0 || idx>=state.pts.length) return; state.pts[idx].x=x+dragVertex.offsetX; state.pts[idx].y=y+dragVertex.offsetY; render(); if(state.closed) auto(); });
  window.addEventListener('pointerup',(e)=>{ if(!dragVertex.active || e.pointerId!==dragVertex.pointerId) return; if(typeof canvas.releasePointerCapture==='function'){ try{ canvas.releasePointerCapture(e.pointerId); }catch(_err){} } dragVertex.active=false; dragVertex.index=-1; dragVertex.pointerId=null; dragVertex.offsetX=dragVertex.offsetY=0; if(state.closed && autoRun.checked) runSelected(); });
  window.addEventListener('pointercancel',(e)=>{ if(!dragVertex.active || e.pointerId!==dragVertex.pointerId) return; if(typeof canvas.releasePointerCapture==='function'){ try{ canvas.releasePointerCapture(e.pointerId); }catch(_err){} } dragVertex.active=false; dragVertex.index=-1; dragVertex.pointerId=null; dragVertex.offsetX=dragVertex.offsetY=0; render(); });
  window.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ closePolygon(); if(autoRun.checked) runSelected(); } if(e.key==='Escape'){ clearAll(); } if(e.key.toLowerCase()==='z'){ undoPoint(); } });
  document.getElementById('btn-close').onclick=()=>{ closePolygon(); if(autoRun.checked) runSelected(); };
  document.getElementById('btn-clear').onclick=()=>{ clearAll(); };
  document.getElementById('color').addEventListener('input',()=>{ render(); if(autoRun.checked) runSelected(); });
  document.getElementById('bg').addEventListener('input',()=>{ render(); if(autoRun.checked) runSelected(); });
  document.getElementById('strokeLW').addEventListener('input',()=>{ if(autoRun.checked) runSelected(); });

  // Preview render
  function render(){ ctx.save(); ctx.fillStyle=bg.value; ctx.fillRect(0,0,canvas.width,canvas.height); if(state.pts.length){ ctx.strokeStyle='#4e6aa1'; ctx.lineWidth=1.5; ctx.setLineDash([6,6]); ctx.beginPath(); ctx.moveTo(state.pts[0].x,state.pts[0].y); for(let i=1;i<state.pts.length;i++) ctx.lineTo(state.pts[i].x,state.pts[i].y); if(state.closed) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); for(const p of state.pts){ ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fillStyle='#a7c4ff'; ctx.fill(); } } ctx.restore(); }
  function tracePolygonPath(){ if(!state.pts.length) return; ctx.beginPath(); ctx.moveTo(state.pts[0].x,state.pts[0].y); for(let i=1;i<state.pts.length;i++) ctx.lineTo(state.pts[i].x,state.pts[i].y); ctx.closePath(); }
  function pointInPoly(x,y,pts){ let inside=false; const n=pts.length; for(let i=0,j=n-1;i<n;j=i++){ const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y; const inter=((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi); if(inter) inside=!inside; } return inside; }
  function smoothstep(edge0, edge1, x){ if(edge1===edge0) return x>=edge1 ? 1 : 0; const t=Math.max(0, Math.min(1, (x-edge0)/(edge1-edge0))); return t*t*(3-2*t); }
  function orientVectorInside(x,y,step,v){ if(pointInPoly(x+v.x*step, y+v.y*step, state.pts)) return v; if(pointInPoly(x-v.x*step, y-v.y*step, state.pts)){ v.x=-v.x; v.y=-v.y; return v; } return null; }

  // Common helpers
  function bbox(pts){ let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity; for(const p of pts){ if(p.x<minx)minx=p.x; if(p.y<miny)miny=p.y; if(p.x>maxx)maxx=p.x; if(p.y>maxy)maxy=p.y; } return {minx,miny,maxx,maxy}; }
  function segDist(x,y,x1,y1,x2,y2){ const vx=x2-x1,vy=y2-y1, wx=x-x1,wy=y-y1; const c1=vx*wx+vy*wy; if(c1<=0) return Math.hypot(x-x1,y-y1); const c2=vx*vx+vy*vy; if(c2<=c1) return Math.hypot(x-x2,y-y2); const t=c1/c2; const px=x1+t*vx, py=y1+t*vy; return Math.hypot(x-px,y-py); }
  function distanceToPolygon(x,y,pts){ let d=Infinity; const n=pts.length; for(let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%n]; const di=segDist(x,y,a.x,a.y,b.x,b.y); if(di<d) d=di; } return pointInPoly(x,y,pts)? d : -d; }
  // SDF + marching squares
  function buildSDF(step){ const bb=bbox(state.pts); const margin=12; const minx=Math.max(0, Math.floor((bb.minx-margin)/step)*step); const miny=Math.max(0, Math.floor((bb.miny-margin)/step)*step); const maxx=Math.min(canvas.width, Math.ceil((bb.maxx+margin)/step)*step); const maxy=Math.min(canvas.height, Math.ceil((bb.maxy+margin)/step)*step); const nx=Math.floor((maxx-minx)/step)+1; const ny=Math.floor((maxy-miny)/step)+1; const field=new Float32Array(nx*ny); for(let j=0;j<ny;j++){ for(let i=0;i<nx;i++){ const x=minx+i*step, y=miny+j*step; field[j*nx+i]=distanceToPolygon(x,y,state.pts); } } return {minx,miny,maxx,maxy,nx,ny,step,field}; }
  function gradientField(nx,ny,step,field){ const gx=new Float32Array(nx*ny), gy=new Float32Array(nx*ny); const at=(i,j)=>field[j*nx+i]; for(let j=1;j<ny-1;j++){ for(let i=1;i<nx-1;i++){ const idx=j*nx+i; gx[idx]=(at(i+1,j)-at(i-1,j))/(2*step); gy[idx]=(at(i,j+1)-at(i,j-1))/(2*step); } } return {gx,gy}; }
  function bilinearGrad(minx,miny,step,nx,ny,gx,gy){ return function sample(x,y){ const fx=(x-minx)/step, fy=(y-miny)/step; const i=Math.floor(fx), j=Math.floor(fy); if(i<0||j<0||i>=nx-1||j>=ny-1) return {gx:0,gy:0}; const tx=fx-i, ty=fy-j; const i0=j*nx+i, i1=i0+1, i2=i0+nx, i3=i2+1; return { gx: gx[i0]*(1-tx)*(1-ty)+gx[i1]*tx*(1-ty)+gx[i2]*(1-tx)*ty+gx[i3]*tx*ty, gy: gy[i0]*(1-tx)*(1-ty)+gy[i1]*tx*(1-ty)+gy[i2]*(1-tx)*ty+gy[i3]*tx*ty }; }; }
  function bilinearScalar(minx,miny,step,nx,ny,field){ return function sample(x,y){ const fx=(x-minx)/step, fy=(y-miny)/step; const i=Math.floor(fx), j=Math.floor(fy); if(i<0||j<0||i>=nx-1||j>=ny-1) return 0; const tx=fx-i, ty=fy-j; const i0=j*nx+i, i1=i0+1, i2=i0+nx, i3=i2+1; return field[i0]*(1-tx)*(1-ty)+field[i1]*tx*(1-ty)+field[i2]*(1-tx)*ty+field[i3]*tx*ty; }; }
  function march(minx,miny,step,nx,ny,field,iso,cb){ function v(i,j){return field[j*nx+i]-iso;} function ip(ax,ay,bx,by,va,vb){ const t=va/(va-vb+1e-12); return {x:ax+t*(bx-ax), y:ay+t*(by-ay)}; } for(let j=0;j<ny-1;j++){ for(let i=0;i<nx-1;i++){ const x=minx+i*step, y=miny+j*step; const vTL=v(i,j), vTR=v(i+1,j), vBR=v(i+1,j+1), vBL=v(i,j+1); let idx=0; if(vTL>0)idx|=1; if(vTR>0)idx|=2; if(vBR>0)idx|=4; if(vBL>0)idx|=8; if(idx===0||idx===15) continue; const pTop=ip(x,y,x+step,y,vTL,vTR); const pRight=ip(x+step,y,x+step,y+step,vTR,vBR); const pBottom=ip(x,y+step,x+step,y+step,vBL,vBR); const pLeft=ip(x,y,x,y+step,vTL,vBL); switch(idx){ case 1: case 14: cb(pLeft,pTop); break; case 2: case 13: cb(pTop,pRight); break; case 3: case 12: cb(pLeft,pRight); break; case 4: case 11: cb(pRight,pBottom); break; case 5: cb(pLeft,pTop); cb(pRight,pBottom); break; case 6: case 9: cb(pTop,pBottom); break; case 7: case 8: cb(pLeft,pBottom); break; case 10: cb(pLeft,pBottom); cb(pTop,pRight); break; } } } }

  // Modes
  function applyHatch(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const ang=(+hAngle.value)*Math.PI/180; const sp=Math.max(2,+hSpace.value); const lw=+hLW.value; const cross=hCross.checked; ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=lw; ctx.lineCap='round'; const bb=bbox(state.pts); const pad=Math.hypot(canvas.width,canvas.height); const cx=(bb.minx+bb.maxx)/2, cy=(bb.miny+bb.maxy)/2; function hatchAt(theta){ ctx.save(); ctx.translate(cx,cy); ctx.rotate(theta); ctx.translate(-cx,-cy); for(let x=bb.minx-pad; x<=bb.maxx+pad; x+=sp){ ctx.beginPath(); ctx.moveTo(x, bb.miny-pad); ctx.lineTo(x, bb.maxy+pad); ctx.stroke(); } ctx.restore(); } hatchAt(ang); if(cross) hatchAt(ang+Math.PI/2); ctx.restore(); }

  function drawContours(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const step=+cStep.value|0; const gap=+cGap.value; const {minx,miny,nx,ny,step:st,field}=buildSDF(step); const levels=[]; let maxD=0; for(const v of field) if(v>maxD) maxD=v; for(let L=gap; L<=maxD; L+=gap) levels.push(L); ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=1.5; for(const iso of levels){ march(minx,miny,st,nx,ny,field,iso,(a,b)=>{ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }); } ctx.restore(); }

  function drawFlow(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const sp=+fSeed.value, h=+fStep.value, maxSteps=+fMax.value|0, useOrtho=fOrtho.checked; const grid=buildSDF(+cStep.value||8); const {minx,miny,maxx,maxy,step,nx,ny,field}=grid; const {gx,gy}=gradientField(nx,ny,step,field); const grad=bilinearGrad(minx,miny,step,nx,ny,gx,gy); ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=1; ctx.lineCap='round'; for(let y=miny;y<=maxy;y+=sp){ for(let x=minx;x<=maxx;x+=sp){ const sx=x+(Math.random()-0.5)*sp*0.6, sy=y+(Math.random()-0.5)*sp*0.6; if(!pointInPoly(sx,sy,state.pts)) continue; const fwd=integrate({x:sx,y:sy},+1), back=integrate({x:sx,y:sy},-1); back.reverse(); const path=back.concat([{x:sx,y:sy}],fwd); if(path.length>2){ ctx.beginPath(); ctx.moveTo(path[0].x,path[0].y); for(let k=1;k<path.length;k++) ctx.lineTo(path[k].x,path[k].y); ctx.stroke(); } } } ctx.restore(); function integrate(p,dir){ const pts=[]; let x=p.x,y=p.y; for(let n=0;n<maxSteps;n++){ if(!pointInPoly(x,y,state.pts)) break; let g=grad(x,y); let vx=g.gx, vy=g.gy; if(useOrtho){ const t=vx; vx=-vy; vy=t; } const len=Math.hypot(vx,vy)||1e-6; vx/=len; vy/=len; x+=dir*vx*h; y+=dir*vy*h; if(!pointInPoly(x,y,state.pts)) break; pts.push({x,y}); } return pts; } }

  function drawGuidedFlow(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const D={x:Math.cos((+gAngle.value)*Math.PI/180), y:Math.sin((+gAngle.value)*Math.PI/180)}; const infl=+gInfl.value; const seedStep=+gSeed.value; const h=+gStep.value; const maxSteps=+gMax.value|0; const grid=buildSDF(+cStep.value||8); const {minx,miny,maxx,maxy,step,nx,ny,field}=grid; const {gx,gy}=gradientField(nx,ny,step,field); const grad=bilinearGrad(minx,miny,step,nx,ny,gx,gy); const dist=bilinearScalar(minx,miny,step,nx,ny,field); const edges=[]; for(let i=0;i<state.pts.length;i++){ const a=state.pts[i], b=state.pts[(i+1)%state.pts.length]; edges.push([a,b]); } const seeds=[]; for(const [a,b] of edges){ const segLen=Math.hypot(b.x-a.x,b.y-a.y); const samples=Math.max(2,Math.floor(segLen/seedStep)); for(let s=0;s<=samples;s++){ const t=s/samples; const x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t; const g=grad(x,y); const nlen=Math.hypot(g.gx,g.gy)||1e-6; const nxg=g.gx/nlen, nyg=g.gy/nlen; if(nxg*D.x+nyg*D.y < -0.2) seeds.push({x,y}); } } ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=1; ctx.lineCap='round'; for(const s of seeds){ const path=integrate(s); if(path.length>1){ ctx.beginPath(); ctx.moveTo(path[0].x,path[0].y); for(let k=1;k<path.length;k++) ctx.lineTo(path[k].x,path[k].y); ctx.stroke(); } } ctx.restore(); function integrate(start){ const pts=[{x:start.x,y:start.y}]; let x=start.x,y=start.y; for(let n=0;n<maxSteps;n++){ if(!pointInPoly(x,y,state.pts)) break; const g=grad(x,y); let tx=-g.gy, ty=g.gx; let tlen=Math.hypot(tx,ty)||1e-6; tx/=tlen; ty/=tlen; const w=smoothstep(0, infl, Math.max(0, dist(x,y))); let vx=(1-w)*tx + w*D.x; let vy=(1-w)*ty + w*D.y; const L=Math.hypot(vx,vy)||1e-6; vx/=L; vy/=L; x+=vx*h; y+=vy*h; pts.push({x,y}); const g2=grad(x,y); const nlen=Math.hypot(g2.gx,g2.gy)||1e-6; const ndx=g2.gx/nlen, ndy=g2.gy/nlen; if(ndx*D.x+ndy*D.y>0.2 || !pointInPoly(x,y,state.pts)) break; } return pts; } }

  function drawSkinFlow(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const angle=(+document.getElementById('skinAngle').value||0)*Math.PI/180; let spacing=+document.getElementById('skinSpacing').value||8; let falloff=+document.getElementById('skinFalloff').value||36; let stepLen=+document.getElementById('skinStep').value||6; spacing=Math.max(1,spacing); falloff=Math.max(1e-3,falloff); stepLen=Math.max(0.5,stepLen); const dir={x:Math.cos(angle), y:Math.sin(angle)};
    const sdfStep=Math.max(3, Math.min(12, stepLen*1.5)); const grid=buildSDF(sdfStep); const {minx,miny,maxx,maxy,step,nx,ny,field}=grid; const {gx,gy}=gradientField(nx,ny,step,field); const grad=bilinearGrad(minx,miny,step,nx,ny,gx,gy); const distSample=bilinearScalar(minx,miny,step,nx,ny,field);
    const seedStep=Math.max(4, spacing*1.35); const jitter=seedStep*0.35;
    ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=1.15; ctx.lineCap='round';
    for(let y=miny; y<=maxy; y+=seedStep){ for(let x=minx; x<=maxx; x+=seedStep){ const sx=x + (Math.random()-0.5)*jitter; const sy=y + (Math.random()-0.5)*jitter; if(!pointInPoly(sx,sy,state.pts)) continue; const fwd=integrateStream(sx,sy,+1); const back=integrateStream(sx,sy,-1); if(!fwd.length && !back.length) continue; if(back.length) back.shift(); back.reverse(); const path=back.concat(fwd); if(path.length>1){ ctx.beginPath(); ctx.moveTo(path[0].x,path[0].y); for(let k=1;k<path.length;k++) ctx.lineTo(path[k].x,path[k].y); ctx.stroke(); } } }
    ctx.restore();
    function flowDir(x,y){ if(x<minx||y<miny||x>maxx||y>maxy) return null; const g=grad(x,y); let gxv=g.gx, gyv=g.gy; const glen=Math.hypot(gxv,gyv); if(glen<=1e-6){ return {x:dir.x,y:dir.y}; } gxv/=glen; gyv/=glen; let tx=-gyv, ty=gxv; if(tx*dir.x + ty*dir.y < 0){ tx*=-1; ty*=-1; } const dist=Math.max(0, distSample(x,y)); const w=smoothstep(0, falloff, dist); let vx=(1-w)*dir.x + w*tx; let vy=(1-w)*dir.y + w*ty; const inward=0.12*(1-Math.min(1, dist/(falloff||1))); vx -= gxv*inward; vy -= gyv*inward; const vlen=Math.hypot(vx,vy); if(vlen<=1e-6) return null; return {x:vx/vlen, y:vy/vlen}; }
    function integrateStream(startX,startY,sign){ const seg=[]; let x=startX, y=startY; for(let iter=0; iter<2000; iter++){ if(!pointInPoly(x,y,state.pts)) break; const dir1=flowDir(x,y); if(!dir1) break; let stepVec=orientVectorInside(x,y,stepLen,{x:dir1.x*sign, y:dir1.y*sign}); if(!stepVec) break; const midX=x + stepVec.x*stepLen*0.5; const midY=y + stepVec.y*stepLen*0.5; const dir2=flowDir(midX,midY); if(dir2){ const midVec=orientVectorInside(x,y,stepLen,{x:dir2.x*sign, y:dir2.y*sign}); if(midVec) stepVec=midVec; }
        const nx=x + stepVec.x*stepLen;
        const ny=y + stepVec.y*stepLen;
        if(seg.length){ const prev=seg[seg.length-1]; if(Math.hypot(nx-prev.x, ny-prev.y)<0.12) break; }
        seg.push({x,y});
        if(!pointInPoly(nx,ny,state.pts)) break;
        x=nx; y=ny;
      }
      return seg;
    }
  }

  // Perlin helpers
  function RNG(seed){ this.s=seed|0; this.next=function(){ this.s=(1664525*this.s+1013904223)|0; return (this.s>>>0)/4294967296; }; }
  function Perlin(seed){ const rng=new RNG(seed); const p=new Uint8Array(512); const perm=new Uint8Array(256); for(let i=0;i<256;i++) perm[i]=i; for(let i=255;i>0;i--){ const j=(rng.next()*(i+1))|0; const t=perm[i]; perm[i]=perm[j]; perm[j]=t; } for(let i=0;i<512;i++) p[i]=perm[i&255]; const grad2=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]; function fade(t){ return t*t*t*(t*(t*6-15)+10); } function lerp(a,b,t){ return a + t*(b-a); } function dot(gx,gy,x,y){ return gx*x + gy*y; } function noise2(x,y){ const X=Math.floor(x)&255, Y=Math.floor(y)&255; const xf=x-Math.floor(x), yf=y-Math.floor(y); const u=fade(xf), v=fade(yf); const aa=p[X+p[Y]], ab=p[X+p[Y+1]], ba=p[X+1+p[Y]], bb=p[X+1+p[Y+1]]; const gAA=grad2[aa&7], gBA=grad2[ba&7], gAB=grad2[ab&7], gBB=grad2[bb&7]; const x1=lerp(dot(gAA[0],gAA[1],xf,yf), dot(gBA[0],gBA[1],xf-1,yf), u); const x2=lerp(dot(gAB[0],gAB[1],xf,yf-1), dot(gBB[0],gBB[1],xf-1,yf-1), u); return lerp(x1, x2, v); } this.fbm2=function(x,y,oct=3){ let amp=1, freq=1, sum=0, norm=0; for(let i=0;i<oct;i++){ sum += amp * noise2(x*freq, y*freq); norm += amp; amp*=0.5; freq*=2.0; } return sum / (norm||1); } }

  function drawNoiseFlow(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const lw=+document.getElementById('strokeLW').value||1.5; const sp=+nSeedSpace.value, h=+nStep.value, maxSteps=+nMax.value|0, scale=+nScale.value, oct=+nOct.value|0, angOff=(+nAngle.value)*Math.PI/180, curl=nCurl.checked, seed=+nSeed.value|0; const field=new Perlin(seed); ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=lw; ctx.lineCap='round'; const bb=bbox(state.pts), pad=8; const minx=Math.max(0, Math.floor((bb.minx-pad)/sp)*sp), miny=Math.max(0, Math.floor((bb.miny-pad)/sp)*sp), maxx=Math.min(canvas.width, Math.ceil((bb.maxx+pad)/sp)*sp), maxy=Math.min(canvas.height, Math.ceil((bb.maxy+pad)/sp)*sp); for(let y=miny;y<=maxy;y+=sp){ for(let x=minx;x<=maxx;x+=sp){ const sx=x+(Math.random()-0.5)*sp*0.6, sy=y+(Math.random()-0.5)*sp*0.6; if(!pointInPoly(sx,sy,state.pts)) continue; const path=integrate({x:sx,y:sy}); if(path.length>1){ ctx.beginPath(); ctx.moveTo(path[0].x,path[0].y); for(let k=1;k<path.length;k++) ctx.lineTo(path[k].x,path[k].y); ctx.stroke(); } } } ctx.restore(); function vecAt(x,y){ const u=x/scale, v=y/scale; if(!curl){ const a=(field.fbm2(u,v,oct)*Math.PI*2)+angOff; return {x:Math.cos(a), y:Math.sin(a)}; } const eps=0.5/scale; const n_x1=field.fbm2(u+eps,v,oct), n_x0=field.fbm2(u-eps,v,oct); const n_y1=field.fbm2(u,v+eps,oct), n_y0=field.fbm2(u,v-eps,oct); const dn_dx=(n_x1-n_x0)/(2*eps), dn_dy=(n_y1-n_y0)/(2*eps); let vx=dn_dy, vy=-dn_dx; const len=Math.hypot(vx,vy)||1e-6; return {x:vx/len, y:vy/len}; } function integrate(start){ const pts=[{x:start.x,y:start.y}]; let x=start.x, y=start.y; for(let n=0;n<maxSteps;n++){ if(!pointInPoly(x,y,state.pts)) break; let v=vecAt(x,y); v=orientVectorInside(x,y,h,v); if(!v) break; const mx=x+v.x*h*0.5, my=y+v.y*h*0.5; let vm=vecAt(mx,my); vm=orientVectorInside(x,y,h,vm); if(!vm) break; x+=vm.x*h; y+=vm.y*h; if(!pointInPoly(x,y,state.pts)) break; pts.push({x,y}); } return pts; } }

  function drawNoiseDashedFlow(){ if(!state.closed){ closePolygon(); } if(!state.closed) return; render(); const lw=+document.getElementById('strokeLW').value||1.5; const sp=+ndSeedSpace.value, h=+ndStep.value, maxSteps=+ndMax.value|0, scale=+ndScale.value, oct=+ndOct.value|0, angOff=(+ndAngle.value)*Math.PI/180, seed=+ndSeed.value|0; const dash=Math.max(0.1,+ndDash.value), gap=Math.max(0.1,+ndGap.value), jitter=Math.max(0, +ndJitter.value); const randomPhase=document.getElementById('ndPhase')?.checked; const even=document.getElementById('ndEven')?.checked; const field=new Perlin(seed); ctx.save(); tracePolygonPath(); ctx.clip('nonzero'); ctx.strokeStyle=color.value; ctx.lineWidth=lw; ctx.lineCap='butt'; const seeds = even ? poissonInPolygon(sp) : gridSeeds(sp); for(const s of seeds){ const path=integrate(s); if(path.length>1) dashed(path); } ctx.restore(); function gridSeeds(step){ const arr=[]; for(let y=0;y<canvas.height;y+=step){ for(let x=0;x<canvas.width;x+=step){ const sx=x+(Math.random()-0.5)*step*0.6, sy=y+(Math.random()-0.5)*step*0.6; if(pointInPoly(sx,sy,state.pts)) arr.push({x:sx,y:sy}); } } return arr; } function vecAt(x,y){ const u=x/scale, v=y/scale; const a=(field.fbm2(u,v,oct)*Math.PI*2)+angOff; return {x:Math.cos(a), y:Math.sin(a)}; } function integrate(start){ const pts=[{x:start.x,y:start.y}]; let x=start.x, y=start.y; for(let n=0;n<maxSteps;n++){ if(!pointInPoly(x,y,state.pts)) break; let v=vecAt(x,y); v=orientVectorInside(x,y,h,v); if(!v) break; x+=v.x*h; y+=v.y*h; if(!pointInPoly(x,y,state.pts)) break; pts.push({x,y}); } return pts; } function dashed(pts){ let phase = randomPhase ? Math.random()*(dash+gap) : 0; let on = phase < dash; let rem = on ? (dash - phase) : (gap + dash - phase); for(let i=1;i<pts.length;i++){ let x0=pts[i-1].x, y0=pts[i-1].y, x1=pts[i].x, y1=pts[i].y; let segLen = Math.hypot(x1-x0, y1-y0); if (segLen <= 1e-6) continue; let ux=(x1-x0)/segLen, uy=(y1-y0)/segLen; let a = 0; while(a < segLen){ let step = Math.min(rem, segLen - a); let drawStep = step; if (on && jitter>0){ drawStep = step * (1 + (Math.random()-0.5)*jitter); } if (on){ ctx.beginPath(); ctx.moveTo(x0 + ux*a, y0 + uy*a); ctx.lineTo(x0 + ux*(a+drawStep), y0 + uy*(a+drawStep)); ctx.stroke(); } a += step; rem -= step; if (rem <= 1e-6){ on = !on; rem = on ? dash : gap; } } } } }

  // Utility: Poisson-disc inside polygon (for even seeding)
  function poissonInPolygon(minDist){ const k=30; const r=minDist; const cell=r/Math.SQRT2; const gridW=Math.ceil(canvas.width/cell), gridH=Math.ceil(canvas.height/cell); const grid=new Array(gridW*gridH).fill(-1); const samples=[]; const active=[]; const rng=Math.random; function gridIdx(x,y){ return Math.floor(y/cell)*gridW + Math.floor(x/cell); } function farEnough(x,y){ const gx=Math.floor(x/cell), gy=Math.floor(y/cell); for(let j=-2;j<=2;j++){ for(let i=-2;i<=2;i++){ const nx=gx+i, ny=gy+j; if(nx<0||ny<0||nx>=gridW||ny>=gridH) continue; const idx=ny*gridW+nx; const sidx=grid[idx]; if(sidx>=0){ const s=samples[sidx]; if(Math.hypot(s.x-x,s.y-y) < r) return false; } } } return true; } let initTries=0; while(initTries++<1000){ const x=r+rng()*(canvas.width-2*r); const y=r+rng()*(canvas.height-2*r); if(pointInPoly(x,y,state.pts)){ samples.push({x,y}); active.push({x,y}); grid[gridIdx(x,y)]=0; break; } } if(!samples.length) return samples; while(active.length){ const aidx=(rng()*active.length)|0; const a=active[aidx]; let found=false; for(let t=0;t<k;t++){ const ang=rng()*Math.PI*2; const rad=r*(1+rng()); const x=a.x + Math.cos(ang)*rad; const y=a.y + Math.sin(ang)*rad; if(x<r||y<r||x>canvas.width-r||y>canvas.height-r) continue; if(!pointInPoly(x,y,state.pts)) continue; if(farEnough(x,y)){ samples.push({x,y}); active.push({x,y}); grid[gridIdx(x,y)]=samples.length-1; found=true; break; } } if(!found){ active.splice(aidx,1); } } return samples; }

  // Basic controls
  function undoPoint(){ if(!state.pts.length) return; state.pts.pop(); state.closed=state.pts.length>=3; render(); }
  function clearAll(){ state.pts=[]; state.closed=false; render(); }
  function closePolygon(){ if(state.pts.length>=3){ state.closed=true; render(); } }

  // --- Minimal self-tests (console) ---
  ;(function selfTests(){ try{ const tri=[{x:0,y:0},{x:50,y:0},{x:0,y:50}]; console.assert(pointInPoly(10,10,tri)===true,'pointInPoly inside'); console.assert(pointInPoly(40,40,tri)===false,'pointInPoly outside'); const dash=16, gap=8; let on=true; let dOn=0, dOff=0; let rem=on?dash:gap; const straight=Array.from({length:50},(_,i)=>({x:i*4,y:0})); for(let i=1;i<straight.length;i++){ const x0=straight[i-1].x, y0=0, x1=straight[i].x, y1=0; const segLen=Math.hypot(x1-x0,y1-y0); let a=0; while(a<segLen){ const step=Math.min(rem, segLen-a); if(on) dOn+=step; else dOff+=step; a+=step; rem-=step; if(rem<=1e-6){ on=!on; rem=on?dash:gap; } } } console.assert(dOn>0 && dOff>0,'dash/gap positive'); }catch(e){ console.warn('Self-tests failed:', e); } })();

  setShape(defaultShape);
  render();
  if(state.closed && autoRun.checked) runSelected();
})();
