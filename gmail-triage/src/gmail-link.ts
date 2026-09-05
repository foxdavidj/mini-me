export function gmailDestination(email:string,threadId?:string,label?:string) {
  const base=`https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}`;
  return base+(threadId?`#all/${encodeURIComponent(threadId)}`:label?`#label/${encodeURIComponent(label)}`:'#inbox');
}
