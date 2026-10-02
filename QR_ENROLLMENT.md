# QR enrollment and training eligibility

The owner opens Training → Training settings → QR enrollment, selects available packages and required biodata fields, then saves and sends settings. First name, surname and phone remain required. Download the school QR code or share its registration link. NIN, when supplied, must be exactly 11 digits; blood group uses the eight supported values. These are format checks, not government verification.

Students use a four-step form without a login. Successful submissions remain pending; they do not create payments or immediately permit training. Private biodata is not saved in browser offline storage. Public submission and registration review require connectivity.

Office staff open Training → Registrations, review a submission and create the student record. Record a real payment through Students, then activate the training registration. The owner can explicitly allow activation without payment; free packages need no payment. This setting never fabricates a payment or clears a balance. Detailed biodata correction is owner-only and requires a reason.

Student progress keeps three things separate: paid lesson balance, the school's chosen training-day target and the recorded 26-day DSSP reference. A qualifying day needs a confirmed completed lesson with at least 30 driving minutes; multiple sessions on one Nigerian date count as one day. Disputed, pending, missed, cancelled and short lessons do not count. Extra lessons can be added beyond 26 with an agreed additional fee. School completion does not issue a licence or certify official approval.

## Testing locally

From the repository root, run `npm run dev:api` and `npm run dev:web` in separate terminals. Sign in as owner, open QR enrollment settings, enable registration and send the saved settings. Open the registration link in a private browser window, submit a test registration, then review it under Registrations.

To test from a phone on the same Wi-Fi, start the web server with `npm run dev --workspace=apps/web -- --host 0.0.0.0`. Use the computer's LAN address and port 5173 in the QR address field, not localhost. The default Vite /api proxy handles public enrollment requests. A custom VITE_API_BASE_URL pointing at localhost will need an address reachable by the phone. Use a hosted HTTPS address for real customer enrollment.

Migration `20260928020000_qr_enrollment` is already applied to this workspace's development database. Other installations need their normal Prisma migrate deploy and client-generation steps. Do not reset existing school data.
