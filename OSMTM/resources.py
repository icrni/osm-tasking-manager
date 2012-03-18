from pyramid.httpexceptions import HTTPFound
from pyramid.url import route_url
from pyramid.security import Allow, Deny, Everyone
from models import Job, User, RootFactory, DBSession

class JobFactory(RootFactory):
    def __init__(self, request):
        session = DBSession()
        job_id = request.matchdict['job']
        job = session.query(Job).get(job_id)
        if job is not None and job.is_private:
            acl = [
                (Allow, 'job:'+job_id, 'job'),
                (Allow, 'group:admin', 'job'),
                (Deny, Everyone, 'job'),
            ]
            self.__acl__ = acl + list(self.__acl__)


import decimal
import datetime

from pyramid.asset import abspath_from_asset_spec
from pyramid.httpexceptions import HTTPBadRequest

from mapnik2 import (PostGIS, Context, Path, Feature, Box2d, Map, Image,
                     load_map, render)
import itertools

from shapely.geometry import asShape

class MapnikRendererFactory:
    def __init__(self, info):
        self.mapfile = abspath_from_asset_spec(info.name)

    def _create_datasource(self, job_id):
        """ Create a Mapnik postgis datasource 
        """
        buffered_table = '(select the_geom from tiles_geometry LEFT JOIN tiles ON id = geometry_id WHERE job_id = %s) as tiles_geometry' % job_id
        ds = PostGIS(host='localhost',user='www-data',password='www-data',dbname='osmtm',table=buffered_table, geometry_field='the_geom')
        return ds 

    def _set_layer_in_map(self, _map, layer_name):
        layer = None
        for i, l in enumerate(_map.layers):
            if l.name != layer_name:
                del _map.layers[i]
            else:
                layer = l
        return layer
    
    def __call__(self, value, system):
        request = system['request']

        if not isinstance(value, tuple):
            value = (None, value);

        layer_name, job_id = value

        # get image width and height
        try:
            width = int(request.params.get('img_width', 600))
        except:
            request.response_status = 400
            return 'incorrect width'
        try:
            height = int(request.params.get('img_height', 400))
        except:
            request.response_status = 400
            return 'incorrect height'

        # get image bbox
        bbox = request.params.get('img_bbox')
        if bbox:
            try:
                bbox = map(float, bbox.split(','))
            except ValueError:
                request.response_status = 400
                return 'incorrect img_bbox'
            bbox = Box2d(*bbox)

        m = Map(width, height)
        load_map(m, self.mapfile)

        if len(m.layers) == 0:
            raise ValueError('no layer in the mapnik map')

        # if no layer_name is provided then, by convention, use
        # the first layer in the mapnik map
        if layer_name is None:
            layer_name = m.layers[0].name

        layer = self._set_layer_in_map(m, layer_name)
        layer.datasource = self._create_datasource(7)

        m.zoom_to_box(bbox or layer.envelope())

        im = Image(width, height)
        render(m, im, 1, 1)

        request.response_content_type = 'image/png'
        return im.tostring('png')
