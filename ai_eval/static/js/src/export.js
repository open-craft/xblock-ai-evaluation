function DataExportXBlock(runtime, element, data) {
  "use strict";

  var status;

  const getStatusUrl = runtime.handlerUrl(element, "get_status");
  const startExportUrl = runtime.handlerUrl(element, "start_export");

  const $results = $("#results-wrapper", element);
  const $refresh = $(".data-export-refresh", $results);
  const $status = $(".data-export-status", $results);
  const $download = $(".data-export-download", $results);
  const $start = $(".data-export-start", $results);

  const updateStatus = function(newStatus) {
    status = newStatus;
    if (newStatus.export_pending) {
      $start.hide();
      $download.hide();
      $download.removeAttr("href");
      $status.text("Running...");
    } else if (newStatus.download_url !== null) {
      $start.show();
      $download.attr("href", newStatus.download_url);
      $download.show();
      $status.text("Ready.");
    } else if (newStatus.last_export_result.error) {
      $start.show();
      $download.hide();
      $download.removeAttr("href");
      $status.text("Error.");
    } else {
      $start.show();
      $download.hide();
      $download.removeAttr("href");
      $status.text("Idle.");
    }
  }

  const getStatus = function() {
    $status.text("...");
    $.ajax({
      type: 'POST',
      url: getStatusUrl,
      data: JSON.stringify({}),
      success: updateStatus,
      error: function() {
        alert(gettext("An error has occurred."));
      },
    });
  }
  $refresh.on("click", getStatus);

  $start.on('click', function() {
    $status.text("...");
    $.ajax({
      type: 'POST',
      url: startExportUrl,
      data: JSON.stringify({}),
      success: updateStatus,
      error: function() {
        alert(gettext("An error has occurred."));
      },
    });
  });

  getStatus();
}
