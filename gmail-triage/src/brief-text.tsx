// Deliberately small: safe text, headings, emphasis, and authenticated Gmail links.
// Never render HTML or follow arbitrary links supplied by message content.
export function BriefText({text}:{text:string}) {
 const inline=(value:string)=>value.split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(\/gmail\?[^)\s]+\))/g).map((part,i)=>{
  if(part.startsWith('**')&&part.endsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
  const link=/^\[([^\]\n]+)\]\((\/gmail\?[^)\s]+)\)$/.exec(part);
  return link?<a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]} ↗</a>:part;
 });
 return <div className="brief-prose">{text.split(/\n\s*\n/).filter(Boolean).map((p,i)=>p.startsWith('## ')?<h3 key={i}>{inline(p.slice(3))}</h3>:<p key={i}>{inline(p)}</p>)}</div>;
}
