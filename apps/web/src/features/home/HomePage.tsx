import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  CloudUpload,
  Fuel,
  Gauge,
  Menu,
  Route,
  ShieldCheck,
  Users,
  Wallet,
  WifiOff,
  X
} from "lucide-react";
import "./home.css";

const questions = [
  [
    "How does the app help me check fuel claims?",
    "Enter the mileage shown on the vehicle’s dashboard and record every fuel purchase. Mark whether you filled the tank completely. Between two full tanks, the app works out how much fuel the vehicle used. The owner sets the expected fuel use, with extra room for lessons and time spent with the engine running. High fuel use is marked for you to check. This does not mean the driver made a false claim."
  ],
  [
    "Can I work without internet?",
    "Yes, after you sign in and load your school’s records. You can then save student details, payments, mileage and fuel records on that device without internet. When the connection returns, keep the app open so it can send your saved work to your school’s account. You need internet for your first sign-in."
  ],
  [
    "How do I know my payment record has been sent?",
    "Waiting to be sent means the record is saved on this device. Record sent means it has reached your school’s account. This does not confirm a bank transfer. If a record needs attention, the app shows a message and lets you try again."
  ],
  [
    "Do I need computer skills?",
    "The setup guide takes you through packages, instructors, vehicles and your first student. Daily lessons have a step-by-step form. Try the payment example below to see how recording works. It uses sample records and does not change your school’s records."
  ],
  [
    "Can I use my phone?",
    "Yes. You can use a phone, tablet or computer. Keep using the same browser for work saved without internet. Do not clear the app’s stored data before your records have been sent."
  ],
  [
    "How do I start?",
    "If you own a driving school, create your school account and follow the setup guide. Staff and students receive their accounts from the school owner."
  ],
  [
    "What can I do in the app?",
    "Keep student records, record payments, check money still owed, and compare vehicle mileage with fuel claims. You can also set fuel limits and see records that need checking. You can also book training outings, track each student’s lessons and let students confirm attendance. Fuel claim approvals and WhatsApp receipts are not available yet."
  ]
] as const;

export function HomePage({
  onSignIn,
  onCreateAccount = onSignIn,
  authenticated = false
}: {
  onSignIn: () => void;
  onCreateAccount?: () => void;
  authenticated?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [recorded, setRecorded] = useState(false);
  const cta = authenticated ? "Open dashboard" : "School sign in";
  function chooseStep(next: number) {
    setStep(next);
    setRecorded(false);
  }
  return (
    <div className="home-page" id="home">
      <a className="skip-link" href="#home-main">
        Skip to content
      </a>
      <header className="home-nav">
        <div className="home-container nav-inner">
          <a className="home-brand" href="#home" aria-label="DriveMaster NG home">
            <span>
              <Route size={25} />
            </span>
            DriveMaster<span className="home-brand-country">NG</span>
          </a>
          <button
            className="home-menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="home-links"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
          <nav
            id="home-links"
            className={menuOpen ? "home-links is-open" : "home-links"}
            aria-label="Website navigation"
          >
            <a href="#benefits" onClick={() => setMenuOpen(false)}>
              Why DriveMaster
            </a>
            <a href="#walkthrough" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#mileage-fuel" onClick={() => setMenuOpen(false)}>
              Mileage & fuel
            </a>
            <a href="#questions" onClick={() => setMenuOpen(false)}>
              FAQs
            </a>
            <button className="home-nav-cta" onClick={onSignIn}>
              {cta}
              <ArrowUpRight size={16} />
            </button>
          </nav>
        </div>
      </header>
      <main id="home-main">
        <section className="home-hero home-container">
          <div className="hero-copy">
            <div className="home-kicker">
              <span />
              BUILT FOR NIGERIAN DRIVING SCHOOLS
            </div>
            <h1>
              Know who has paid.
              <br />
              Know who has trained.
              <br />
              <em>Know what training costs.</em>
            </h1>
            <p className="hero-description">
              Keep lessons, payments and fuel records together. See money still owed and what may
              remain from each student’s fee after training costs. Save records even when the
              internet goes off.
            </p>
            <div className="hero-buttons">
              {authenticated ? (
                <button className="home-button primary" onClick={onSignIn}>
                  Open dashboard <ArrowRight size={18} />
                </button>
              ) : (
                <button className="home-button primary" onClick={onCreateAccount}>
                  Create your school account <ArrowRight size={18} />
                </button>
              )}
              <button className="home-text-link" onClick={onSignIn}>
                {authenticated ? "Go to your dashboard" : "Already have an account? Sign in"}
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="hero-reassurance">
              <span>
                <Check size={15} />
                Try the example without an account
              </span>
              <span>
                <Check size={15} />
                Save records even without internet
              </span>
            </div>
          </div>
          <div className="hero-product" aria-label="Illustrative product preview with sample data">
            <div className="preview-window">
              <div className="preview-toolbar">
                <span className="preview-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>YOUR SCHOOL IN ONE VIEW</span>
                <span className="preview-sample">EXAMPLE</span>
              </div>
              <div className="preview-body">
                <div className="preview-greeting">
                  <div>
                    <span>SCHOOL OVERVIEW</span>
                    <h2>See your records in one place.</h2>
                  </div>
                  <span className="preview-avatar">AO</span>
                </div>
                <div className="preview-metrics">
                  <div>
                    <span>Registered students</span>
                    <strong>24</strong>
                    <small>Every record, in one place</small>
                  </div>
                  <div>
                    <span>Payments sent today</span>
                    <strong>₦75,000</strong>
                    <small>
                      <CircleCheck size={12} />A clear payment trail
                    </small>
                  </div>
                </div>
                <div className="preview-ledger">
                  <div>
                    <h3>Recent payments</h3>
                    <Wallet size={16} />
                  </div>
                  {[
                    { name: "Amina Bello", initials: "AB", amount: "₦25,000", pending: false },
                    { name: "Tobi Adeyemi", initials: "TA", amount: "₦50,000", pending: false },
                    { name: "Chinedu Eze", initials: "CE", amount: "₦15,000", pending: true }
                  ].map((row) => (
                    <div className="preview-row" key={row.name}>
                      <span className="preview-person">{row.initials}</span>
                      <span>
                        {row.name}
                        <small>{row.pending ? "Saved on this device" : "Payment received"}</small>
                      </span>
                      <strong>{row.amount}</strong>
                      <span className={row.pending ? "preview-pending" : "preview-confirmed"}>
                        {row.pending ? "Waiting to be sent" : "Record sent"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="preview-bottom">
                  <span>
                    <ShieldCheck size={14} />
                    Your school’s records
                  </span>
                  <span>Simple. Organized. Accessible.</span>
                </div>
              </div>
            </div>
            <div className="offline-float">
              <span>
                <WifiOff size={21} />
              </span>
              <div>
                <strong>No internet? Keep recording.</strong>
                <p>Save on this device. Send when internet returns.</p>
              </div>
            </div>
            <p className="preview-caption">Illustrative preview · sample names and figures</p>
          </div>
        </section>
        <div className="home-proof-strip">
          <div className="home-container">
            <span>FOR YOUR DAILY SCHOOL WORK</span>
            <p>
              <Users size={18} />
              Student records
            </p>
            <p>
              <Wallet size={18} />
              Payments in naira
            </p>
            <p>
              <WifiOff size={18} />
              Works without internet
            </p>
            <p>
              <Fuel size={18} />
              Mileage & fuel tracking
            </p>
          </div>
        </div>
        <section className="home-section home-container" id="benefits">
          <div className="section-intro">
            <p className="home-kicker">KNOW WHAT IS HAPPENING</p>
            <h2>
              Spend less time checking notebooks.
              <br />
              <em>Find the answers in one place.</em>
            </h2>
            <p>
              When your records are scattered, simple questions take too long to answer. Put the
              answers within reach.
            </p>
          </div>
          <div className="benefit-grid">
            <article>
              <span className="benefit-icon">
                <Wallet />
              </span>
              <p className="benefit-number">01 / KNOW YOUR MONEY</p>
              <h3>
                Know what’s paid.
                <br />
                Know what’s due.
              </h3>
              <p>
                See each student’s fees, payments and money still owed. Know which payment records
                have been sent and which are waiting.
              </p>
              <a href="#walkthrough" onClick={() => chooseStep(1)}>
                See how to record a payment <ArrowUpRight size={16} />
              </a>
            </article>
            <article>
              <span className="benefit-icon">
                <Users />
              </span>
              <p className="benefit-number">02 / FIND STUDENT DETAILS</p>
              <h3>
                The right record.
                <br />
                Right when you need it.
              </h3>
              <p>
                Find students by name or phone number. Open their details and payment history
                without switching between notebooks and spreadsheets.
              </p>
              <a href="#walkthrough" onClick={() => chooseStep(0)}>
                See a student record <ArrowUpRight size={16} />
              </a>
            </article>
            <article>
              <span className="benefit-icon">
                <CloudUpload />
              </span>
              <p className="benefit-number">03 / KEEP WORKING</p>
              <h3>
                No internet
                <br />
                shouldn’t stop your work.
              </h3>
              <p>
                Keep using the records already loaded on your phone or computer. New entries stay on
                that device until the internet returns.
              </p>
              <a href="#walkthrough" onClick={() => chooseStep(2)}>
                See how saved records are sent <ArrowUpRight size={16} />
              </a>
            </article>
          </div>
        </section>
        <section className="home-section home-container" aria-labelledby="training-value-title">
          <div className="section-intro">
            <p className="home-kicker">FOLLOW EVERY STUDENT’S TRAINING</p>
            <h2 id="training-value-title">From the first payment to the last lesson.</h2>
            <p>Know what happened, what it cost and what needs your attention.</p>
          </div>
          <div className="benefit-grid">
            <article>
              <span className="benefit-icon">
                <Route />
              </span>
              <h3>See who has trained</h3>
              <p>
                Book one to three students with an instructor and vehicle. Record each student’s
                driving time. Students sign in to confirm their lesson or report a problem.
              </p>
            </article>
            <article>
              <span className="benefit-icon">
                <Fuel />
              </span>
              <h3>Follow the fuel money</h3>
              <p>
                Set fuel money per student. See the total before an outing starts. Record the
                purchase once and find it in your vehicle’s fuel history too.
              </p>
            </article>
            <article>
              <span className="benefit-icon">
                <Wallet />
              </span>
              <h3>Understand each student’s costs</h3>
              <p>
                See fuel spending, the instructor’s share of monthly pay, and the estimated cost of
                remaining lessons beside the student’s fee.
              </p>
              <p>
                Money left after training is an estimate. Rent, repairs and other school costs still
                need to be deducted.
              </p>
            </article>
          </div>
        </section>
        <section className="home-fuel-section" id="mileage-fuel" aria-labelledby="home-fuel-title">
          <div className="home-container home-fuel-grid">
            <div className="home-fuel-copy">
              <p className="home-kicker">MILEAGE TRACKING VS FUEL CLAIMS</p>
              <h2 id="home-fuel-title">
                Know how far your vehicles go.
                <br />
                <em>Check how much fuel they use.</em>
              </h2>
              <p>
                Compare the distance travelled with the fuel bought. See which vehicles use more
                fuel than expected, so you know what to check.
              </p>
              <ol className="home-fuel-steps">
                <li>
                  <span>
                    <Gauge size={20} />
                  </span>
                  <div>
                    <h3>Enter the mileage and fuel bought.</h3>
                    <p>
                      Save the dashboard mileage reading, driver, litres, cost and receipt reference
                      against the right vehicle.
                    </p>
                  </div>
                </li>
                <li>
                  <span>
                    <Fuel size={20} />
                  </span>
                  <div>
                    <h3>Let the app work it out.</h3>
                    <p>
                      Record every fuel purchase between two full tanks. The app works out how much
                      fuel was used for the distance travelled.
                    </p>
                  </div>
                </li>
                <li>
                  <span>
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <h3>See what needs checking.</h3>
                    <p>
                      Set how much fuel the vehicle should use. Allow extra fuel for lessons and
                      time with the engine running. The app shows when fuel use is above your limit.
                    </p>
                  </div>
                </li>
              </ol>
              <button className="home-button primary" onClick={onSignIn}>
                {authenticated ? "Open your workspace" : "Sign in to track your vehicles"}
                <ArrowRight size={18} />
              </button>
              <p className="home-fuel-small">
                Record without internet after sign-in. Fuel checks update after your records are
                sent.
              </p>
            </div>
            <figure
              className="home-fuel-example"
              aria-label="Illustrative mileage and fuel comparison"
            >
              <div className="home-fuel-example-top">
                <span>
                  <Fuel size={17} /> CHECKING FUEL USE
                </span>
                <span>EXAMPLE</span>
              </div>
              <div className="home-fuel-vehicle">
                <h3>Toyota Corolla</h3>
                <p>Example: fuel bought between two full tanks.</p>
              </div>
              <div className="home-fuel-journey">
                <div>
                  <span>First full tank</span>
                  <strong>
                    25,000 <small>km</small>
                  </strong>
                </div>
                <ArrowRight size={20} />
                <div>
                  <span>Next full tank</span>
                  <strong>
                    25,500 <small>km</small>
                  </strong>
                </div>
              </div>
              <div className="home-fuel-numbers">
                <div>
                  <span>Distance travelled</span>
                  <strong>
                    500 <small>km</small>
                  </strong>
                </div>
                <div>
                  <span>Refills after the first fill</span>
                  <strong>
                    75 <small>litres</small>
                  </strong>
                </div>
              </div>
              <div className="home-fuel-comparison">
                <div>
                  <span>Fuel limit set by the owner</span>
                  <strong>12 L / 100 km</strong>
                </div>
                <div className="home-fuel-bar limit" aria-hidden="true">
                  <span />
                </div>
                <div>
                  <span>Fuel used from these records</span>
                  <strong>15 L / 100 km</strong>
                </div>
                <div className="home-fuel-bar actual" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="home-fuel-alert">
                <span>PLEASE CHECK</span>
                <strong>25% more fuel than the set limit</strong>
                <p>
                  15 extra litres for this distance. Check the refills, mileage and driving
                  conditions before drawing a conclusion.
                </p>
              </div>
              <figcaption>
                Illustrative figures, not a live school record. Flags prompt review; they do not
                establish misuse or approve claims.
              </figcaption>
            </figure>
          </div>
        </section>
        <section className="walkthrough-section" id="walkthrough">
          <div className="home-container walkthrough-grid">
            <div className="walkthrough-copy">
              <p className="home-kicker">TRY IT BEFORE YOU SIGN IN</p>
              <h2>
                From student record
                <br />
                to money still owed.
                <br />
                <em>Follow three easy steps.</em>
              </h2>
              <p>
                Explore this example before you sign in. No form to fill. No school data required.
              </p>
              <div className="walkthrough-tabs" role="tablist" aria-label="Example workflow">
                {["Find your student", "Record a payment", "Check if it was sent"].map(
                  (label, index) => (
                    <button
                      id={`workflow-tab-${index}`}
                      key={label}
                      role="tab"
                      aria-selected={step === index}
                      aria-controls="workflow-panel"
                      tabIndex={step === index ? 0 : -1}
                      onClick={() => chooseStep(index)}
                      onKeyDown={(event) => {
                        if (
                          [
                            "ArrowDown",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowLeft",
                            "Home",
                            "End"
                          ].includes(event.key)
                        ) {
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? 2
                                : (step +
                                    (event.key === "ArrowDown" || event.key === "ArrowRight"
                                      ? 1
                                      : 2)) %
                                  3;
                          chooseStep(next);
                          document.getElementById(`workflow-tab-${next}`)?.focus();
                        }
                      }}
                    >
                      <span>0{index + 1}</span>
                      <strong>{label}</strong>
                      <ArrowRight size={18} />
                    </button>
                  )
                )}
              </div>
            </div>
            <div
              className="workflow-card"
              id="workflow-panel"
              role="tabpanel"
              aria-labelledby={`workflow-tab-${step}`}
            >
              <div className="workflow-card-top">
                <span>INTERACTIVE EXAMPLE</span>
                <span>Sample data only</span>
              </div>
              <div className="workflow-student">
                <span>AB</span>
                <div>
                  <h3>Amina Bello</h3>
                  <p>Student record · Example school</p>
                </div>
                <CircleCheck size={22} />
              </div>
              {step === 0 ? (
                <>
                  <div className="workflow-field">
                    <span>Tuition fee</span>
                    <strong>₦100,000.00</strong>
                  </div>
                  <div className="workflow-field">
                    <span>Previously paid</span>
                    <strong>₦25,000.00</strong>
                  </div>
                  <div className="workflow-balance">
                    <span>Money still owed</span>
                    <strong>₦75,000.00</strong>
                  </div>
                  <p className="workflow-help">
                    The details you need, together in one student record.
                  </p>
                  <button className="home-button primary" onClick={() => chooseStep(1)}>
                    Next: record a payment <ArrowRight size={17} />
                  </button>
                </>
              ) : step === 1 ? (
                <>
                  <div className="workflow-field">
                    <span>Example payment</span>
                    <strong>₦10,000.00</strong>
                  </div>
                  <div className="workflow-field">
                    <span>Payment method</span>
                    <strong>Cash</strong>
                  </div>
                  <div className="workflow-balance">
                    <span>
                      {recorded ? "Money owed after this saved payment" : "Current balance"}
                    </span>
                    <strong>{recorded ? "₦65,000.00" : "₦75,000.00"}</strong>
                  </div>
                  <div aria-live="polite" className="workflow-help">
                    {recorded
                      ? "Example payment saved on this device. It is waiting to be sent to your school’s account."
                      : "Try recording a payment to see how the balance changes."}
                  </div>
                  <button
                    className="home-button primary"
                    onClick={() => (recorded ? chooseStep(2) : setRecorded(true))}
                  >
                    {recorded ? "Next: check if it was sent" : "Try recording ₦10,000"}
                    <ArrowRight size={17} />
                  </button>
                </>
              ) : (
                <>
                  <div className="sync-example">
                    <CloudUpload size={35} />
                    <h4>Saved on this device. Waiting to be sent.</h4>
                    <p>
                      When the internet returns, keep the app open. It sends your saved records and
                      marks them “Record sent” when they reach your school’s account. This does not
                      verify a bank transfer.
                    </p>
                  </div>
                  <div className="workflow-field">
                    <span>Needs a closer look?</span>
                    <strong>Check saved records</strong>
                  </div>
                  <p className="workflow-help">
                    See which records need checking and try sending them again. This example does
                    not save or send real records.
                  </p>
                  <button className="home-button primary" onClick={onSignIn}>
                    {cta}
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
        <section className="home-section home-container home-fit">
          <div>
            <p className="home-kicker">A FOCUSED START</p>
            <h2>
              Everything you need
              <br />
              for a clearer front desk.
            </h2>
            <p>
              Start with the daily essentials. Your team can follow the same straightforward
              process, from registration to payment review.
            </p>
            <button className="home-text-link" onClick={onSignIn}>
              {cta}
              <ArrowUpRight size={17} />
            </button>
          </div>
          <ul>
            {[
              "A searchable student directory",
              "School fees and money still owed, in naira",
              "Cash, bank transfer, and POS payment records",
              "A dashboard that separates accepted records and work waiting to be sent",
              "See records waiting to be sent or checked",
              "Layouts for your phone, tablet, and computer"
            ].map((text) => (
              <li key={text}>
                <Check size={19} />
                {text}
              </li>
            ))}
          </ul>
        </section>
        <section className="home-section home-container faq-section" id="questions">
          <div className="section-intro">
            <p className="home-kicker">BEFORE YOU GET STARTED</p>
            <h2>
              Good questions.
              <br />
              <em>Straight answers.</em>
            </h2>
          </div>
          <div className="faq-list">
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="home-container">
          <div className="home-final-cta">
            <div>
              <p className="home-kicker">LESS PAPERWORK. MORE TIME FOR YOUR SCHOOL.</p>
              <h2>
                Keep your school’s records
                <br />
                in one place.
              </h2>
              <p>
                Students, payments, mileage and fuel claims.
                <br />
                Together, in one workspace.
              </p>
            </div>
            <div>
              <button className="home-button light" onClick={onSignIn}>
                {cta}
                <ArrowRight size={19} />
              </button>
              <span>Existing school accounts · Phone and password</span>
              <a href="#walkthrough">Want a closer look? Try the example.</a>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-footer home-container">
        <a className="home-brand" href="#home">
          <span>
            <Route size={21} />
          </span>
          DriveMaster<span className="home-brand-country">NG</span>
        </a>
        <p>Built for the everyday work of Nigerian driving schools.</p>
        <span>© {new Date().getFullYear()} DriveMaster NG</span>
      </footer>
    </div>
  );
}
