"use client";

export default function GlobalErrorPage() {
  return (
    <html lang="en">
      <body>
        <main role="alert">
          <h1>This application is temporarily unavailable.</h1>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a href="/">Go home</a>
        </main>
      </body>
    </html>
  );
}
