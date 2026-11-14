/* Insights search: filters the list as you type, using a small prebuilt index. No requests until the box is used. */
(function(){
  var q=document.getElementById("post-q"),list=document.getElementById("posts"),status=document.getElementById("post-status");
  if(!q||!list)return;
  var idx=null,loading=false;
  function load(cb){if(idx)return cb();if(loading)return;loading=true;
    fetch("insights/search-index.json").then(function(r){return r.json()}).then(function(d){idx=d;cb()}).catch(function(){loading=false})}
  function run(){
    var terms=q.value.toLowerCase().split(/\s+/).filter(Boolean),shown=0;
    var cards=list.querySelectorAll(".post-card");
    cards.forEach(function(c){
      var p=idx&&idx.filter(function(x){return x.slug===c.dataset.slug})[0];
      var hay=p?(p.title+" "+p.summary+" "+p.tags.join(" ")+" "+p.text).toLowerCase():c.textContent.toLowerCase();
      var ok=terms.every(function(t){return hay.indexOf(t)>-1});
      c.hidden=!ok;if(ok)shown++;
    });
    var none=document.getElementById("post-none");
    if(!shown&&terms.length){if(!none){none=document.createElement("p");none.id="post-none";none.className="posts-empty";list.appendChild(none)}none.textContent='Nothing matches "'+q.value.trim()+'". Try a different word.'}
    else if(none)none.remove();
    status.textContent=terms.length?shown+(shown===1?" article found":" articles found"):"";
  }
  q.addEventListener("input",function(){load(run)});
})();
