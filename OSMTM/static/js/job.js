var map = new OpenLayers.Map('map', {
    theme: null,
    controls: [
        new OpenLayers.Control.Navigation(),
        new OpenLayers.Control.ZoomPanel(),
        new OpenLayers.Control.Attribution()
    ]
});
var osm = new OpenLayers.Layer.OSM('OSM', null, {
    transitionEffect: 'resize'
});
map.addLayer(osm);
var layer = new OpenLayers.Layer.Vector("Objects", {
    style: {
        strokeColor: "blue",
        strokeWidth: 3,
        strokeOpacity: 0.5,
        fillOpacity: 0.2,
        fillColor: "lightblue",
        pointRadius: 6
    },
    projection: new OpenLayers.Projection("EPSG:4326"),
    displayInLayerSwitcher: false
});

map.addLayer(layer);

var colors = ["#aaa", "red", "green"];
var context = {
    getColor: function(feature) {
        var checkin = feature.attributes.checkin || 0;
        return colors[checkin];
    },
    getStrokeColor: function(feature) {
        if (feature.attributes.username) {
            return "orange";
        }
        if (feature.fid == current_task) {
            return "blue";
        }
        return "black";
    },
    getStrokeWidth: function(feature) {
        return (feature.fid == current_task || feature.attributes.username) ?
            2 : 0.3;
    },
    getStrokeOpacity: function(feature) {
        return (feature.fid == current_task || feature.attributes.username) ?
            1 : 0.5;
    },
    getZIndex: function(feature) {
        if (feature.attributes.username) {
            return 2;
        }
        if (feature.fid == current_task) {
            return 3;
        }
        return 1;
    }
};
var template = {
    fillColor: "${getColor}",
    fillOpacity: 0.5,
    strokeColor: "${getStrokeColor}",
    strokeWidth: "${getStrokeWidth}",
    strokeOpacity: "${getStrokeOpacity}",
    graphicZIndex: "${getZIndex}",
    cursor: "pointer"
};
var style = new OpenLayers.Style(template, {context: context});
var tilesLayer = new OpenLayers.Layer.Vector("Tiles Layers", {
    styleMap: new OpenLayers.StyleMap(style),
    rendererOptions: {
        zIndexing: true
    }
});
map.addLayer(tilesLayer);

function showTilesStatus() {
    var protocol = new OpenLayers.Protocol.HTTP({
        url: tiles_status_url,
        format: new OpenLayers.Format.JSON(),
        callback: function(response) {
            if (response.success()) {
                $.each(tilesLayer.features, function(index, feature) {
                    feature.attributes = {};
                });
                var total = tilesLayer.features.length,
                    done = 0,
                    validated = 0,
                    cur = 0;
                $.each(response.features, function(id, val) {
                    var feature = tilesLayer.getFeatureByFid(id);
                    feature.attributes = val;
                    if (val.checkin == 1 || val.checkin == 2) {
                        done++;
                    }
                    if (val.checkin == 2) {
                        validated++;
                    }
                    if (val.username) {
                        cur++;
                    }
                });
                // FIXME, hack
                tilesLayer.drawn = false;
                tilesLayer.redraw();
                $('#map_legend ul').html(function() {
                    return '<li><div class=""></div>Total (' + total + ')</li>' +
                           '<li><div class="checkin1"></div>Done (' + done + ')</li>' +
                           '<li><div class="checkin2"></div>Validated (' + validated + ')</li>' +
                           '<li><div class="checkout"></div>Curr. worked on (' + cur + ')</li>';
                });
            }
        }
    });
    protocol.read();
}

var protocol = new OpenLayers.Protocol.HTTP({
    url: job_geom,
    format: new OpenLayers.Format.GeoJSON(),
    callback: function(response) {
        if (response.success()) {
            layer.addFeatures(response.features);
            map.zoomToExtent(layer.getDataExtent());
        }
    }
});
protocol.read();

protocol = new OpenLayers.Protocol.HTTP({
    url: tiles_url,
    format: new OpenLayers.Format.GeoJSON(),
    callback: function(response) {
        if (response.success()) {
            tilesLayer.addFeatures(response.features);
            showTilesStatus();
            // Client-side routes
            Sammy(function() {
                this.get('#task/:x/:y/:zoom', function() {
                    loadTask(this.params.x, this.params.y, this.params.zoom);
                });
                this.get('#task/:x/:y/:zoom/:action', function() {
                    loadTask(this.params.x, this.params.y, this.params.zoom);
                });
            }).run();
        }
    }
});
protocol.read();

var featureControl = new OpenLayers.Control.SelectFeature(tilesLayer, {
    onSelect: function(feature) {
        //var attr = feature.attributes;
        //if (attr.checkin >=  2 || attr.username) {
            //return false;
        //}
        // FIXME
        //if (current_tile && current_tile.user == user) {
            //alert("You already have a task to work on");
            //return false;
        //}
        var id = feature.fid.split('-');
        hideTooltips();
        location.hash = ["task", id[0], id[1], id[2]].join('/');
    }
});
map.addControls([featureControl]);
featureControl.activate();
featureControl.handlers.feature.stopDown = false;

var current_task;
function loadEmptyTask() {
    current_task = null;
    tilesLayer.redraw();
    $('#task').load([job_url, "task"].join('/'));
}
function loadTask(x, y, zoom) {
    hideTooltips();
    // it may already be done
    location.hash = ["task", x, y, zoom].join('/');
    $('#task').load(
        [job_url, "task", x, y, zoom].join('/'),
        function(responseText, textStatus, request) {
            if (textStatus == 'error') {
                alert(responseText);
            } else {
                $('#task_tab').tab('show');
                var id = [x, y, zoom].join('-');
                current_task = id;
                var feature = tilesLayer.getFeatureByFid(id);
                tilesLayer.redraw();
                var z = map.getZoomForExtent(feature.geometry.getBounds()),
                    centroid = feature.geometry.getCentroid(),
                    lonlat = new OpenLayers.LonLat(centroid.x, centroid.y);
                map.zoomTo(zoom - 1);
                map.panTo(lonlat);
            }
        }
    );
}


var chart_drawn = false;
$('a[href="#chart"]').on('shown', function (e) {
    if (chart_drawn) {
        return false;
    }

    if ($('#chart_div').length < 1) {
        return;
    }
    var done_values = window.chart_done,
        validated_values = window.chart_validated,
        date, done, validated,
        data_done = [],
        data_validated = [],
        i, len;
    for (i=0, len=done_values.length; i < len; i++) {
        date = new Date(done_values[i][0]);
        done = done_values[i][1];
        data_done.push([date.getTime(), done]);
    }
    for (i=0, len=validated_values.length; i < len; i++) {
        date = new Date(validated_values[i][0]);
        validated = validated_values[i][1];
        data_validated.push([date.getTime(), validated]);
    }
    var chart = new Highcharts.Chart({
        title: null,
        chart: {
            renderTo: 'chart_div',
            type: 'spline'
        },
        xAxis: {
            type: 'datetime',
            dateTimeLabelFormats: {
                month: '%e. %b',
                year: '%b'
            }
        },
        yAxis: {
            title: {
                text: 'Number of tasks'
            },
            min: 0
        },
        series: [{
            name: 'Done',
            data: data_done,
            marker: {
                enabled: false,
                states: {
                    hover: {
                        enabled: true
                    }
                }
            }
        }, {
            name: 'Validated',
            data: data_validated,
            marker: {
                enabled: false,
                states: {
                    hover: {
                        enabled: true
                    }
                }
            }
        }],
        colors: ['#FF4D4D', '#4DA64D']
    });
    // prevent multiple renderings
    chart_drawn = true;
});

$('form').live('submit', function(e) {
    var form = this;
    function load() {
        hideTooltips();
        var formData = $(form).serializeObject();
        var submitName = $("button[type=submit][clicked=true]").attr("name");
        formData[submitName] = true;
        $('#task').load(form.action, formData, function(responseText) {
            loadEmptyTask();
            showTilesStatus();
        });
    }
    if ($(form).has($('#commentModal')).length > 0) {
        $('#commentModal').modal('show');
        $('#task_comment').focus();
        $('#commentModalCloseBtn').on('click', function() {
            if ($('#task_comment')[0].value !== '') {
                $('#commentModal').modal('hide');
                load();
            }
        });
    } else {
        load();
    }
    return false;
});
$("form button[type=submit]").live('click', function() {
    $("button[type=submit]", $(this).parents("form")).removeAttr("clicked");
    $(this).attr("clicked", "true");
});
$.fn.serializeObject = function()
{
    var o = {};
    var a = this.serializeArray();
    $.each(a, function() {
        if (o[this.name] !== undefined) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
        } else {
            o[this.name] = this.value || '';
        }
    });
    return o;
};

function takeOrUnlock(e) {
    hideTooltips();
    $.getJSON(this.href, function(data) {
        showTilesStatus();
        if (data.tile) {
            var tile = data.tile;
            loadTask(tile.x, tile.y, tile.z);
            return;
        }
        if (data.error_msg) {
            $('#task_error_msg').html(data.error_msg).show()
                .delay(3000)
                .fadeOut();
            return;
        }
        if (data.split_id) {
            splitTask(data.split_id, data.new_tiles);
        }
        loadEmptyTask();
    });
    return false;
}
$('#take_random').live('click', takeOrUnlock);
$('#lock').live('click', takeOrUnlock);
$('#unlock').live('click', takeOrUnlock);
$('#validate').live('click', takeOrUnlock);
$('#split').live('click', takeOrUnlock);
$('#clear').live('click', loadEmptyTask);

function splitTask(id, newTiles) {
    var feature = tilesLayer.getFeatureByFid(id);
    tilesLayer.removeFeatures([feature]);

    var format = new OpenLayers.Format.GeoJSON();
    tilesLayer.addFeatures(format.read(newTiles));
}

function hideTooltips() {
    $('[rel=tooltip]').tooltip('hide');
}

var task_time_left;
$(function(){
    var countdown = setInterval(function(){
        $("span#countdown").html(Math.floor(task_time_left/60));
        if (task_time_left === -10) {
            window.location = window.location;
        }
        task_time_left--;
    }, 1000);
});

