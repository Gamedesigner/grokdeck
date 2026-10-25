import SwiftUI

struct ComputersView: View {
  @EnvironmentObject private var store: DeckStore
  @Environment(\.dismiss) private var dismiss
  let openAgent: (String) -> Void
  @State private var runningOnly = false
  private var shown: [DeckComputer] {
    store.computers.filter { !runningOnly || $0.state == .running }.sorted {
      if rank($0.state) != rank($1.state) { return rank($0.state) < rank($1.state) }
      return $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }
  }
  var body: some View {
    List {
      Section {
        Picker("Show computers", selection: $runningOnly) {
          Text("All").tag(false)
          Text("Running").tag(true)
        }.pickerStyle(.segmented).accessibilityIdentifier("computer-filter")
        Text("Computer status is shown per bot. Updates happen when you open this list or refresh it.")
          .font(.caption).foregroundStyle(.secondary)
        if let checked = store.computersCheckedAt {
          Text("Checked \(checked.formatted(date: .omitted, time: .shortened))")
            .font(.caption2).foregroundStyle(.secondary)
        }
      }
      if store.computersLoading { ProgressView("Checking computers…") }
      if let error = store.computersError {
        Section { Text(error).font(.callout).foregroundStyle(.orange) }
      }
      if !store.computersComplete {
        Section {
          Text("Some computer statuses could not be checked. Refresh to try again.")
            .font(.caption).foregroundStyle(.orange)
        }
      }
      ForEach(shown) { computer in
        VStack(alignment: .leading, spacing: 9) {
          HStack {
            Label(computer.name, systemImage: "desktopcomputer").font(.headline)
            Spacer()
            Text(label(computer.state)).font(.caption.weight(.semibold))
              .foregroundStyle(color(computer.state))
          }
          if computer.state == .unknown {
            Text(computer.error ?? "Status unavailable. This does not mean the computer is stopped.")
              .font(.caption).foregroundStyle(.secondary)
          }
          ForEach(computer.windows) { window in
            Label(window.label.isEmpty ? "Window \(window.index + 1)" : window.label,
              systemImage: "macwindow").font(.subheadline).foregroundStyle(.secondary)
          }
          if store.agents.contains(where: { $0.id == computer.agentId }) {
            Button("Open conversation", systemImage: "text.bubble") { openAgent(computer.agentId) }
              .buttonStyle(.borderless).font(.callout)
          }
        }.padding(.vertical, 5).accessibilityIdentifier("computer-\(computer.agentId)")
      }
      if shown.isEmpty && !store.computersLoading && store.computersError == nil {
        ContentUnavailableView(runningOnly ? "No running computers found" : "No computers listed",
          systemImage: "desktopcomputer")
      }
      Section {
        Text("This list shows status only. Starting or viewing a computer is not available here yet.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .navigationTitle("Computers").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Refresh computers", systemImage: "arrow.clockwise") { Task { await store.refreshComputers() } }
          .labelStyle(.iconOnly).disabled(store.computersLoading)
      }
      ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
    }
    .refreshable { await store.refreshComputers() }
    .task { if store.computers.isEmpty { await store.refreshComputers() } }
  }
  private func rank(_ state: ComputerState) -> Int {
    switch state { case .running: 0; case .hibernated: 1; case .unknown: 2; case .absent: 3 }
  }
  private func label(_ state: ComputerState) -> String {
    switch state { case .running: "Running"; case .hibernated: "Hibernated"; case .unknown: "Unknown"; case .absent: "No computer" }
  }
  private func color(_ state: ComputerState) -> Color {
    switch state { case .running: .green; case .hibernated: .orange; case .unknown: .orange; case .absent: .secondary }
  }
}
