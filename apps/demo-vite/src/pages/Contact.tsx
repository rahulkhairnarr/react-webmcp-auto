import { useState } from 'react';

export function Contact() {
  const [sent, setSent] = useState<string>('');
  return (
    <section>
      <h1>Contact us</h1>
      <form
        id="contact"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget).entries());
          setSent(`Thanks ${String(d.name)}, topic: ${String(d.topic)}`);
        }}
      >
        <label>
          Name <input name="name" required />
        </label>
        <label>
          Email <input name="email" type="email" required />
        </label>
        <label htmlFor="topic">Topic</label>
        <select id="topic" name="topic">
          <option value="sales">Sales</option>
          <option value="support">Support</option>
        </select>
        <fieldset>
          <legend>Priority</legend>
          <label>
            <input type="radio" name="priority" value="low" defaultChecked /> Low
          </label>
          <label>
            <input type="radio" name="priority" value="high" /> High
          </label>
        </fieldset>
        <label>
          Message <textarea name="message" />
        </label>
        <button type="submit">Request callback</button>
      </form>
      <div role="status">{sent}</div>
    </section>
  );
}
