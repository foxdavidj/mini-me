import { expect,test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefText } from '../src/brief-text';
import { gmailDestination } from '../src/gmail-link';

test('briefs render useful formatting without executing mail HTML or arbitrary links',()=>{
 const html=renderToStaticMarkup(<BriefText text={'## Today\n\n**One useful thing.** [Open mail](/gmail?key=one%40example.com%3A123)\n\n<script>alert(1)</script> [Bad](javascript:alert(1)) [Tracking](https://example.com/pixel)'}/>);
 expect(html).toContain('<h3>Today</h3>');
 expect(html).toContain('<strong>One useful thing.</strong>');
 expect(html).toContain('href="/gmail?key=one%40example.com%3A123"');
 expect(html).not.toContain('<script>');
 expect(html).not.toContain('href="javascript:');
 expect(html).not.toContain('href="https://example.com');
});

test('Gmail destinations select the connected account and find archived threads',()=>{
 expect(gmailDestination('one+personal@example.com','abc123')).toBe('https://mail.google.com/mail/?authuser=one%2Bpersonal%40example.com#all/abc123');
 expect(gmailDestination('two@example.com',undefined,'Mini-me/Read')).toBe('https://mail.google.com/mail/?authuser=two%40example.com#label/Mini-me%2FRead');
 expect(gmailDestination('two@example.com')).toEndWith('#inbox');
});
