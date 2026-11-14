/* Mobile menu: toggles the nav links on small screens. */
(function(){
  var nav=document.querySelector(".nav"),btn=document.getElementById("nav-toggle"),links=document.getElementById("nav-links");
  if(!nav||!btn||!links)return;
  document.documentElement.classList.add("navjs");
  function set(open){nav.classList.toggle("open",open);btn.setAttribute("aria-expanded",open?"true":"false");btn.setAttribute("aria-label",open?"Close menu":"Open menu")}
  btn.addEventListener("click",function(){set(!nav.classList.contains("open"))});
  links.addEventListener("click",function(e){if(e.target.closest("a"))set(false)});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&nav.classList.contains("open")){set(false);btn.focus()}});
  document.addEventListener("click",function(e){if(nav.classList.contains("open")&&!nav.contains(e.target))set(false)});
  window.addEventListener("resize",function(){if(window.innerWidth>1340)set(false)});
})();

/* Open a FAQ answer when a link points straight at it. */
(function(){
  function openTarget(){
    var el=location.hash.length>1&&document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if(el&&el.tagName==="DETAILS"){el.open=true;el.scrollIntoView()}
  }
  window.addEventListener("hashchange",openTarget);
  openTarget();
})();

/* Highlight the nav link for the section in view. */
(function(){
  if(!("IntersectionObserver" in window))return;
  var map={},secs=[];
  document.querySelectorAll('.nav-links a[href^="#"]:not(.btn)').forEach(function(a){
    var el=document.getElementById(a.getAttribute("href").slice(1));
    if(el){map[el.id]=a;secs.push(el)}
  });
  if(!secs.length)return;
  var cur=null;
  function set(id){
    if(id===cur)return;cur=id;
    Object.keys(map).forEach(function(k){
      var on=k===id;map[k].classList.toggle("is-active",on);
      if(on)map[k].setAttribute("aria-current","location");else map[k].removeAttribute("aria-current");
    });
  }
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){if(e.isIntersecting)set(e.target.id)});
    if(window.scrollY<80)set(null);
  },{rootMargin:"-45% 0px -50% 0px"});
  secs.forEach(function(s){io.observe(s)});
})();

/* Theme switch: Auto (device) / Light / Dark, remembered in this browser. */
(function(){
  var nav=document.querySelector(".nav-inner");if(!nav)return;
  var root=document.documentElement,KEY="lwfx-theme";
  var ICON={auto:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
   light:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
   dark:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'};
  var LABEL={auto:"Match my device",light:"Light theme",dark:"Dark theme"};
  function cur(){var t=root.getAttribute("data-theme");return t==="light"||t==="dark"?t:"auto"}
  var box=document.createElement("div");box.className="theme-switch";box.setAttribute("role","group");box.setAttribute("aria-label","Colour theme");
  ["auto","light","dark"].forEach(function(m){
    var b=document.createElement("button");b.type="button";b.dataset.mode=m;b.innerHTML=ICON[m];b.title=LABEL[m];b.setAttribute("aria-label",LABEL[m]);
    b.addEventListener("click",function(){
      if(m==="auto")root.removeAttribute("data-theme");else root.setAttribute("data-theme",m);
      try{if(m==="auto")localStorage.removeItem(KEY);else localStorage.setItem(KEY,m)}catch(e){}
      paint();
    });
    box.appendChild(b);
  });
  function paint(){var c=cur();box.querySelectorAll("button").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.mode===c?"true":"false")})}
  paint();nav.appendChild(box);
})();
