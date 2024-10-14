/* Javascript for ShortAnswerAIEvalXBlock. */
function ShortAnswerAIEvalXBlock(runtime, element) {
    "use strict";

    StudioEditableXBlockMixin(runtime, element);

    var $input = $('#xb-field-edit-attachments');

    var buildFileInput = function() {
        var $wrapper = $('<div id="attachments-wrapper" class="wrapper-list-settings"/>');

        var $fileList = $('<ul class="list-settings list-set"/>');
        var files = JSON.parse($input.val() || "{}");
        for (var filename of Object.keys(files)) {
            var $fileItem = $('<li class="list-settings-item"/>');
            $fileItem.append(filename);
            var $deleteButton = $('<button class="action" type="button"/>');
            $deleteButton.append($('<i class="icon fa fa-trash"/>'));
            var $deleteButtonText = $('<span class="sr"/>');
            $deleteButtonText.append(gettext("Delete file"));
            $deleteButton.append($deleteButtonText);
            $deleteButton.data("attachment-name", filename);
            $deleteButton.click(deleteAttachment);
            $fileItem.append($deleteButton);
            $fileList.append($fileItem);
        }
        $wrapper.append($fileList);

        var $fileInput = $('<input type="file"/>');
        $wrapper.append($fileInput);

        var $uploadButton = $('<button class="action" type="button"/>');
        $uploadButton.append($('<i class="icon fa fa-upload"/>'));
        $uploadButton.click(addAttachment);
        var $uploadButtonText = $('<span class="sr"/>');
        $uploadButtonText.append(gettext("Upload file"));
        $uploadButton.append($uploadButtonText);
        $wrapper.append($uploadButton);

        var $oldWrapper = $('#attachments-wrapper');
        if ($oldWrapper.length) {
            $input.closest('li').addClass('is-set');
            $oldWrapper.replaceWith($wrapper);
        } else {
            $input.hide();
            $wrapper.insertBefore($input);
        }
    }

    var deleteAttachment = function() {
        var $button = $(this);

        var files = JSON.parse($input.val());
        delete files[$button.data("attachment-name")];
        $input.val(JSON.stringify(files));

        buildFileInput();
    }

    var insertAttachment = function(files, filename, data) {
        var foundFilename = filename;
        var i = 0;
        while (Object.prototype.hasOwnProperty.call(files, foundFilename)) {
            i++;
            foundFilename = `${filename} (${i})`;
        }
        files[foundFilename] = data;
    }

    var addAttachment = function() {
        var $button = $(this);
        var $fileInput = $button.prev('input[type="file"]');
        var file = $fileInput[0].files[0];

        if (file !== undefined) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var files = JSON.parse($input.val());
                insertAttachment(files, file.name, e.target.result);
                $input.val(JSON.stringify(files));
                buildFileInput();
            }
            reader.readAsText(file);
        }
    }

    buildFileInput();
}
