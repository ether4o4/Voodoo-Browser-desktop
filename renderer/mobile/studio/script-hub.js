(function(root){
  'use strict';
  function diff(before,after){
    const a=before.split('\n'),b=after.split('\n');let first=0,last=0;
    while(first<a.length&&first<b.length&&a[first]===b[first])first++;
    if(first===a.length&&first===b.length)return 'No source changes.';
    while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
    const start=Math.max(0,first-3),endA=Math.min(a.length,a.length-last+3),endB=Math.min(b.length,b.length-last+3);
    return ['--- installed.user.js','+++ proposed.user.js',`@@ -${start+1},${endA-start} +${start+1},${endB-start} @@`,
      ...a.slice(start,first).map(x=>' '+x),...a.slice(first,a.length-last).map(x=>'-'+x),
      ...b.slice(first,b.length-last).map(x=>'+'+x),...b.slice(b.length-last,endB).map(x=>' '+x)].join('\n');
  }
  root.VoodooHub={diff};
  if(typeof module==='object')module.exports={diff};
})(globalThis);
