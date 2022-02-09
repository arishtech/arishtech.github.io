<?php

if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

//
// Metabox of the PAGE
// Set a unique slug-like ID
//
$postgallery = 'restly_postmeta_gallery';

//
// Create a metabox
//
CSF::createMetabox( $postgallery, array(
    'title'        => esc_html('Post Format image Gallery','restly'),
    'post_type'    => array( 'post' ),
    'post_formats' => 'gallery',
) );

//
// Create a section
//
CSF::createSection( $postgallery, array(
    'title'  => esc_html__( 'Add Gallery Image', 'restly' ),
    'icon'   => 'fas fa-rocket',
    'fields' => array(
        array(
            'id'          => 'restly_post_gallery',
            'type'        => 'gallery',
            'title'       => esc_html('Gallery','restly'),
            'add_title'   => esc_html('Add Image','restly'),
            'edit_title'  => esc_html('Edit Image','restly'),
            'clear_title' => esc_html('Remove Image','restly'),
        ),
    ),
) );