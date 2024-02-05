# SMTP Notification 

A notification service based on nodemailer using SMTP

## Details

It uses the email-templates npm package and pug for rendering html emails.
Documentation for this can be found at [forwardemail/email-templates][emailTemplateRepo].


## Available options (default configuration)

```js
{
  fromEmail: "no-reply@blancsoft.com",

  // transport object is input directly into nodemailer.createtransport()
  // so anything that works there should work here
  // see: https://nodemailer.com/smtp/#1-single-connection and https://nodemailer.com/transports/
  // A SendMail transport example:
  // transport: {
  //     sendmail: true,
  //     path: "/usr/sbin/sendmail",
  //     newline: "unix",
  // },

  // An Office365 SMTP transport:
  transport: {
    host: "smtp.office365.com",
    port: 587,
    secureConnection: false,
    auth: {
      user: process.env.EMAIL_SENDER_ADDRESS,
      pass: process.env.EMAIL_SENDER_PASS,
    },
    tls: {
      ciphers: "SSLv3",
    },
    requireTLS: true,
  },

// emailTemplatePath is the filesystem path where your email templates are stored
  emailTemplatePath: "data/emailTemplates",

  // templateMap maps a template name to an event type.
  // The template name is a path relative to emailTemplatePath.
  // Only the registered events gets subscribed.
  templateMap: {
    // "eventName": "templatePath",
    "order.placed": "orderplaced",
  },
}
```

[emailTemplateRepo]: https://github.com/forwardemail/email-templates
