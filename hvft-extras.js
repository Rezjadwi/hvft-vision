(function(){
  const $=id=>document.getElementById(id), mb=$('masterbar'), stage=$('stage')
  if(!mb||!stage) return
  const grp=document.createElement('div'); grp.className='mv'
  const mic=$('mic'); if(mic){ mic.textContent=mic.classList.contains('on')?'◉ MIC ARMED':'MIC · SAFE'
    new MutationObserver(()=>{ const t=mic.classList.contains('on')?'◉ MIC ARMED':'MIC · SAFE'; if(mic.textContent!==t) mic.textContent=t }).observe(mic,{attributes:true,attributeFilter:['class']})
    grp.appendChild(mic) }
  mb.insertBefore(grp, mb.children[0]||null)
  const g2=document.createElement('div'); g2.className='mv'; g2.style.marginLeft='auto'
  const send=$('send'); if(send){ send.textContent='OUTPUT ▸'; g2.appendChild(send) }
  const map=$('mapmon'); if(map){ map.textContent='MAP ▸'; g2.appendChild(map) }
  mb.appendChild(g2)
  const au=document.createElement('div'); au.id='hvAudio'
  ;['spec','specinfo','band'].forEach(id=>{ const el=$(id); if(el) au.appendChild(el) })
  const lp=$('layerprev'); (lp&&lp.nextSibling)? stage.insertBefore(au, lp.nextSibling) : stage.appendChild(au)
})()
