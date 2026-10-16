// Reads and writes macOS Calendar (EventKit) for plan-my-week. On a Mac it takes the place of Outlook's
// COM interface, and works with any account added to Calendar, e.g. Exchange / Microsoft 365.
//
//   swift mac-calendar.swift list
//   swift mac-calendar.swift read  <account> <calendar> <from yyyy-MM-dd> <to yyyy-MM-dd> <marker> <category>
//   swift mac-calendar.swift apply <account> <calendar> <plan.json> <marker>
//
// <calendar> is "*" when the account has only one writable calendar. Events whose notes contain <marker>
// are the skill's own: `read` reports them with <category>, `apply` replaces them.
import EventKit
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let store = EKEventStore()
let calendar = Calendar.current

func requestAccess() {
    let done = DispatchSemaphore(value: 0)
    var granted = false
    let handler: (Bool, Error?) -> Void = { ok, _ in granted = ok; done.signal() }
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: handler)
    } else {
        store.requestAccess(to: .event, completion: handler)
    }
    done.wait()
    if !granted {
        fail("NO_CALENDAR_ACCESS: allow your terminal app under System Settings > Privacy & Security > Calendars (Full Access), then try again.")
    }
    store.refreshSourcesIfNecessary()
}

func describe(_ c: EKCalendar) -> String {
    "\(c.source.title) | \(c.title)" + (c.allowsContentModifications ? "" : "  (read-only)")
}

func allCalendarsText() -> String {
    store.calendars(for: .event).map { "  " + describe($0) }.sorted().joined(separator: "\n")
}

func findCalendar(account: String, title: String) -> EKCalendar {
    let all = store.calendars(for: .event)
    func matches(_ c: EKCalendar, exact: Bool) -> Bool {
        let source = c.source.title
        let accountOK = exact ? source == account : source.localizedCaseInsensitiveContains(account)
        return accountOK && (title == "*" || c.title == title)
    }
    var found = all.filter { matches($0, exact: true) }
    if found.isEmpty { found = all.filter { matches($0, exact: false) } }
    if title == "*" { found = found.filter { $0.allowsContentModifications } }
    if found.count == 1 { return found[0] }
    if found.isEmpty {
        fail("Calendar '\(account) | \(title)' not found. Calendars on this Mac (account | calendar):\n\(allCalendarsText())")
    }
    fail("More than one calendar matches '\(account) | \(title)' - set mac.calendar in config.json. Calendars (account | calendar):\n\(allCalendarsText())")
}

func day(_ text: String) -> Date {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    guard let d = f.date(from: text) else { fail("Bad date: \(text)") }
    return calendar.startOfDay(for: d)
}

// "HH:mm" on the given day, as wall-clock time (so a DST change doesn't shift it).
func at(_ d: Date, _ hhmm: String) -> Date {
    let p = hhmm.split(separator: ":").compactMap { Int($0) }
    guard p.count == 2 else { fail("Bad time: \(hhmm)") }
    if p[0] == 24 { return calendar.date(byAdding: .day, value: 1, to: d)! }
    return calendar.date(bySettingHour: p[0], minute: p[1], second: 0, of: d)!
}

let stamp: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    return f
}()

// Same codes as Outlook's BusyStatus: 0 free, 1 tentative, 2 busy, 3 out of office.
func busyCode(_ e: EKEvent) -> Int {
    switch e.availability {
    case .free: return 0
    case .tentative: return 1
    case .unavailable: return 3
    default: return 2
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("Usage: swift mac-calendar.swift list | read ... | apply ...") }
requestAccess()

do {
    switch args[1] {
    case "list":
        print("Calendars on this Mac (account | calendar):\n" + allCalendarsText())

    case "read":
        guard args.count == 8 else { fail("Usage: read <account> <calendar> <from> <to> <marker> <category>") }
        let cal = findCalendar(account: args[2], title: args[3])
        let marker = args[6], category = args[7]
        let predicate = store.predicateForEvents(withStart: day(args[4]), end: day(args[5]), calendars: [cal])
        var out: [[String: Any]] = []
        for e in store.events(matching: predicate) {
            if e.status == .canceled { continue }
            if let me = e.attendees?.first(where: { $0.isCurrentUser }), me.participantStatus == .declined { continue }
            // All-day events end at 23:59:59 in EventKit; Outlook (and plan.ps1) expect the next midnight.
            var end: Date = e.endDate
            if e.isAllDay {
                let endDay = calendar.startOfDay(for: e.endDate)
                end = endDay == e.endDate ? endDay : calendar.date(byAdding: .day, value: 1, to: endDay)!
            }
            out.append([
                "subject": e.title ?? "",
                "start": stamp.string(from: e.startDate),
                "end": stamp.string(from: end),
                "allDay": e.isAllDay,
                "busy": busyCode(e),
                "categories": (e.notes ?? "").contains(marker) ? category : "",
            ])
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [])
        print(String(data: data, encoding: .utf8)!)

    case "apply":
        guard args.count == 6 else { fail("Usage: apply <account> <calendar> <plan.json> <marker>") }
        let cal = findCalendar(account: args[2], title: args[3])
        if !cal.allowsContentModifications { fail("Calendar '\(describe(cal))' is read-only.") }
        let marker = args[5]
        let data = try Data(contentsOf: URL(fileURLWithPath: args[4]))
        guard let plan = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let weekStart = plan["weekStart"] as? String else { fail("Could not read \(args[4]).") }
        var planned = plan["events"] as? [[String: Any]] ?? []
        if let one = plan["events"] as? [String: Any] { planned = [one] }

        let monday = day(weekStart)
        let nextMonday = calendar.date(byAdding: .day, value: 7, to: monday)!
        let old = store.events(matching: store.predicateForEvents(withStart: monday, end: nextMonday, calendars: [cal]))
            .filter { $0.startDate >= monday && $0.startDate < nextMonday && !$0.hasRecurrenceRules && ($0.notes ?? "").contains(marker) }
        for e in old { try store.remove(e, span: .thisEvent, commit: false) }

        var created = 0
        for p in planned {
            guard let date = p["date"] as? String, let start = p["start"] as? String, let end = p["end"] as? String else { continue }
            let e = EKEvent(eventStore: store)
            e.calendar = cal
            e.title = p["title"] as? String ?? ""
            e.notes = p["body"] as? String
            e.startDate = at(day(date), start)
            e.endDate = at(day(date), end)
            e.availability = .busy
            try store.save(e, span: .thisEvent, commit: false)
            created += 1
        }
        try store.commit()
        print("Calendar: removed \(old.count) previously planned events, created \(created) events.")

    default:
        fail("Unknown command '\(args[1])'. Use list, read or apply.")
    }
} catch {
    fail("Calendar error: \(error.localizedDescription)")
}
