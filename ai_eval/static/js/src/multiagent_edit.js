/* Javascript for MultiAgentAIEvalXBlock. */
function MultiAgentAIEvalXBlock(runtime, element) {
    "use strict";

    StudioEditableXBlockMixin(runtime, element);

    var $inputs = $('#xb-field-edit-scenario_data, #xb-field-edit-character_data');

    var addFileInput = function() {
        var $wrapper = $('<div/>');
        $wrapper.css('margin-left', 'calc(25% + 15px)');
        $wrapper.css('margin-top', '5px');
        var $fileInput = $('<input type="file"/>');
        $fileInput.css('width', 'calc(45% - 10px)');
        $wrapper.append($fileInput);
        var $loadButton = $('<button class="action" type="button"/>');
        $loadButton.append(gettext("Load"));
        $loadButton.click(loadFile);
        $loadButton.css('margin-left', '10px');
        $wrapper.append($loadButton);

        $(this).closest('.wrapper-comp-setting').append($wrapper);
    }

    var loadFile = function() {
        var $button = $(this);
        var $fileInput = $button.prev('input[type="file"]');
        var $field = $button.closest('.wrapper-comp-setting').children('textarea');
        var file = $fileInput[0].files[0];
        if (file !== undefined) {
            var reader = new FileReader();
            reader.onload = function(e) {
                $field.val(JSON.stringify(JSON.parse(e.target.result), null, 2));
                $field.trigger("change");
            }
            reader.readAsText(file);
        }
    }

    $inputs.each(function() {
        var $input = $(this);
        try {
            $input.val(JSON.stringify(JSON.parse($input.val()), null, 2));
        } catch (e) {}
    })

    $inputs.each(addFileInput);
}
